# Ops11 삭제 Worker 준비 증거

## 상태

- `productionReady: false`
- `schedulerDeployed: false`
- `deletionIntakeEnabled: false`
- `deletionUiEnabled: false`
- `hostedSupabaseAcceptance: false`
- `requiresEarlierOperationalGates: true`

이 문서는 로컬 준비 증거입니다. 실제 Supabase·Cloudflare·GitHub 변경, Scheduler 배포,
런타임 KV 변경, 삭제 접수 및 UI 활성화는 수행하지 않았습니다. 선행 운영 관문을 순서대로
통과하기 전에는 이 묶음을 운영에 적용하지 않습니다.

## 구현된 안전 경계

삭제 작업은 한 번에 모든 것을 지우지 않고 다음 네 단계로 재개됩니다.

1. `database`: 파일 소유권을 다시 확인하고, 삭제할 경로를 비공개 임시 표에 고정한 뒤
   관계형 데이터를 삭제하거나 공유 기록의 사용자 식별자를 제거합니다.
2. `storage`: `cabinets`와 계정이 만든 안전센터 확인 문서만 Supabase Storage API로
   제거합니다. 경로는 서비스 역할 전용 RPC를 통해서만 노출됩니다.
3. `auth`: 계정 작업만 Supabase Auth 사용자를 제거합니다. 연구실 삭제는 관리자 계정을
   제거하지 않습니다.
4. `finalize`: 사진 메타데이터와 임시 파일 경로를 없애고 작업을 완료합니다.

각 단계는 앞 단계가 완료된 경우 건너뛸 수 있습니다. Storage 또는 Auth 성공 직후 응답이
끊겨도 다음 예약 실행이 같은 작업을 다시 안전하게 확인합니다. 실패한 작업은 최대 12회만
재시도하고, 오류 원문·이메일·연구실명·시약명·파일 경로는 Worker 로그에 남기지 않습니다.

DB의 단일 실행 임대와 작업별 2분 임대를 함께 사용합니다. 따라서 Cron이 겹쳐도 같은 작업이
동시에 처리되지 않습니다. 내부 API는 사용자 JWT가 아니라 32자 이상의 전용 Bearer secret만
받으며 본문은 받지 않습니다. Staging 호출에는 별도의 Cloudflare Access 서비스 토큰도
필요하고, 그 토큰은 운영 주소로 전송되지 않습니다.

## 로컬 검증

- PostgreSQL 17.11 빈 DB 두 곳에 기준선부터 Ops11까지 연속 적용
- 합성 개인 계정: 개인 사진과 개인 재고 제거, 공유 연구실 멤버십·운영자 역할 즉시 회수,
  공유 재고의 사용자 식별자 제거, Auth 삭제 후 완료
- 합성 연구실: 연구실 데이터와 사진 대상으로 처리하되 관리자 Auth 계정 보존
- 민감 파일 경로와 사진 메타데이터가 완료 전에 정리되는지 확인
- 두 번째 Worker 실행 임대가 거부되는지 확인
- Staging·운영 Wrangler dry-run과 생성된 binding 타입 검사
- 401, 503, 207, 잘못된 JSON, `failed>0`, 연속 2회 실패, 3분 성공 공백 회귀시험
- 예약 호출 3회 성공 뒤에도 코드가 삭제 접수나 UI를 자동으로 켜지 않는지 확인

이 검증은 전부 합성 데이터이며 외부 Supabase·Cloudflare 호출은 0회입니다.

## 실제 운영 적용 순서

1. 운영 1·2 관찰과 운영 3~10을 계획된 순서로 통과합니다.
2. Staging DB에 Ops11 migration을 적용하고 pgTAP·Advisor의 새 차이가 0인지 확인합니다.
3. Staging Pages 내부 API와 전용 Scheduler Worker를 배포합니다. Worker, 대상 URL, Bearer
   secret, Access 자격값, KV는 운영과 공유하지 않습니다.
4. `account_deletion_enabled=false`, `maintenance_worker_enabled=true`로 빈 큐 예약 실행을
   세 번 연속 확인합니다. `enablement_eligible=true`는 준비 신호일 뿐 자동 승인 신호가 아닙니다.
5. 합성 계정과 합성 연구실로 단계별 중단·재시도·최대 횟수·파일 소유권을 확인하고 모든
   합성 행과 파일을 제거합니다.
6. 같은 검사를 운영용 Worker에 적용하되 삭제 접수와 UI는 계속 OFF로 둡니다.
7. 운영 예약 호출 3회가 성공한 뒤 정확한 KV 확인문구로 접수를 켜고, 별도 웹 변경으로
   삭제 UI를 켭니다. 두 동작은 한 번에 하지 않습니다.
8. 첫 실제 작업을 관찰한 뒤 전용 secret을 회전하고 이전 값이 401인지 확인합니다.

## 자동 차단과 되돌림

Scheduler는 목적 API가 `401`, `503`, `207`, 비정상 JSON 또는 `failed>0`을 반환하면 실패로
봅니다. 두 번 연속 실패하거나 마지막 성공 뒤 3분이 지나면 다음 다섯 필드를 모두 보존하는
완전한 KV 문서로 삭제 접수와 Worker를 OFF로 만듭니다.

```json
{
  "voice_disposal_mode": "redirect",
  "kosha_content_mode": "full",
  "account_deletion_enabled": false,
  "maintenance_worker_enabled": false,
  "storage_backup_enabled": true
}
```

- Worker 문제: 위 두 삭제 스위치를 OFF, Cron 비활성화, 작업표와 이벤트 보존
- Pages 문제: 내부 API를 직전 성공 배포로 되돌리고 Bearer secret 회전
- DB 문제: 하향 migration 금지, 새 전진 수정 또는 검증된 백업 복구
- Storage 문제: 작업을 `retry_wait`로 남기고 경로 표를 삭제하지 않음
- Auth 문제: 관계형 접근권한은 이미 회수된 상태로 재시도

## 백업과 남는 위험

Supabase Storage 원본은 삭제 단계에서 제거하지만, R2의 내용 주소형 일일 백업 본문은 다른
완료 manifest와 공유될 수 있어 즉시 지우지 않습니다. 최근 복구 목록의 참조가 사라지고 보존
기간과 두 번의 GC 확인을 통과한 뒤 제거됩니다. 이 백업 보존 지연은 개인정보 안내와 삭제
운영 문서에 명시해야 합니다.

KV는 강한 잠금 저장소가 아니므로 작업 동시성은 PostgreSQL 임대로 막습니다. KV는 오직
운영 스위치와 Scheduler 건강상태에 사용합니다. KV 전파 지연 때문에 스위치 변경 후 최소
2분 동안 실제 응답을 반복 확인합니다.
