# 2026-10-02 운영 관찰 재확인

최초 확인 시각은 2026-10-02 01:37~01:54 KST다. 아래 최초 확인은 운영 상태의 읽기 전용 점검이며 운영 배포, DB 변경, KV 수정, Worker 활성화, 사진 삭제는 수행하지 않았다. 이후 승인된 출시 작업의 Quality·Staging DB 검증과 운영 재조회는 마지막 절에 구분해 기록한다.

**판정: 기존 7일 최소 관찰 시각은 지났으나, 사진 백업 참조 모드가 실제 DB와 달라 Ops1·2 관찰을 전체 완료로 닫지 않는다.** 신규 캐비넷 휴지통 출시에는 별도로 유지보수 처리기의 예약 실행 검증이 필요하다. 추가 7일 대기를 현재 수정 작업의 선행조건으로 두지 않는다.

## 웹/API 및 배포

- 공개 `https://burillab.com/release.json`과 고정 `https://bdab5c8f.buril-lab.pages.dev/release.json`은 모두 HTTP 200, production, 동일 SHA `0a17f695e2a5c5b36ce43853dbfb550c7f15f33b`이며 CSP가 있다.
- AI·Gemini·음성 API 9개에 미인증 빈 요청을 보내 모두 HTTP 401 `AUTH_REQUIRED`를 확인했다. 인증된 AI 실행이나 유료 제공자 호출은 하지 않았다. 상세 집계는 `output/ops-recheck-public-20261002.json`이다.
- Cloudflare Pages의 production 최근 7일 집계는 성공 132, 오류 0이다. 표시된 내부·스크립트·CPU·메모리·클라이언트 연결 종료 오류도 0이다. 초기 로딩 중의 0 값은 증거로 사용하지 않았다. 이 집계는 Pages 요청의 범위이며 별도 Worker의 모든 실행을 보증하지 않는다.
- [동일 SHA Production 배포](https://github.com/haengjoo123/buril-lab/actions/runs/33968451711)와 [Staging 배포](https://github.com/haengjoo123/buril-lab/actions/runs/33967615014)는 성공했다.
- 최신 HEAD `d99fe93c4ae09674cda01bd24b2a463ac23686c2`의 [Quality 실행](https://github.com/haengjoo123/buril-lab/actions/runs/36308718708)은 실패다. DB 릴리스 경계, 전체 단위 검사, Ops3 API 범위 검사에서 실패했으며 해당 DB 권한 시험은 건너뛰었다. 타입·린트와 Cloudflare 계약 검사는 통과했다. 새 캐비넷 변경은 운영에 배포되지 않았다.

## 운영 런타임 및 스케줄러

Cloudflare 운영 KV `buril-lab-runtime-config-production`에서 다음 값을 직접 읽었다.

| 설정 | 실제 값 |
|---|---|
| `voice_disposal_mode` | `redirect` |
| `kosha_content_mode` | `full` |
| `account_deletion_enabled` | `false` |
| `maintenance_worker_enabled` | `false` |
| `storage_backup_enabled` | `true` |

스케줄러 health v1의 마지막 시도·성공은 모두 `2026-09-18 13:23:00 KST`다. 누적 연속 성공 18,515, 실패 0, `enablement_eligible=true`지만 이 값은 과거 성공 기록이다. 현재의 최근 예약 호출 성공이나 활성화 준비 완료로 인정하지 않는다. OFF 전환 원인·주체 및 이후 Worker 실행 로그는 이번 확인으로 확정하지 않았다.

기존 Ops1·2의 안전 설정에는 삭제·유지보수 OFF가 포함돼 있으므로 OFF 자체를 기존 웹 배포 장애로 해석하지 않는다. 다만 새 캐비넷의 10일 후 자동 정리는 유지보수 실행에 의존하므로, 새 릴리스에서 OFF를 그대로 두고 자동 정리 완료를 주장할 수 없다. 계정 삭제 접수와 유지보수 실행은 따로 검증한다.

기존 Wrangler 인증은 원격 KV 조회에서 HTTP 401을 반환했다. 새 토큰을 만들지 않고 이미 인증된 브라우저 대시보드로 값을 확인했다.

## 최신 완료 백업과 실제 사진 참조

R2 `buril-lab-cabinet-backups-production`은 공개 접근 Disabled다. `control/latest.json`이 가리키는 최신 완료 스냅샷은 다음과 같다.

| 항목 | 확인값 |
|---|---|
| 스냅샷 | `20260930t174513645z-f1ad9c949b8d9be7bd581725` |
| 완료 시각 | `2026-10-01 02:45:19.061 KST` |
| manifest 실제 파일 크기 | 1,558 bytes |
| manifest SHA-256 | `98f3d648decb9db43bffe0e7cb84dee1302528fe2b629b7f343085e937e7f0cb` |
| 원본 참조 모드 | **`legacy_url`** |
| 파일 집계 | 전체 3, 참조 0, 미참조 3 |
| 본문 집계 | 3,794,343 bytes, 신규 업로드 0, 재사용 3 |

`latest.json` → `complete.json` → `manifest.sha256` → 다운로드한 실제 `manifest.json` 바이트의 SHA-256이 모두 일치한다. manifest 본문 파일 크기의 합도 선언된 전체 크기와 같다. 사진 본문은 다운로드하거나 열지 않았으며 내용 주소형 R2 본문의 존재·개별 메타데이터·실제 바이트 해시 및 복구 시험은 이번에 검증하지 않았다. 따라서 manifest 검증만으로 전체 복구 성공을 선언하지 않는다.

운영 Supabase 프로젝트 `zafxzidbtbryiksemlwc`의 현재 DB에는 캐비넷 9개, 유효한 비공개 `image_path` 참조 1개, 기존 `image_url` 참조 0개가 있다. 현재 `image_path`의 MD5 비교값 `e208971f942ebf2269d472f24c514412`는 최신 manifest의 383,490-byte 항목과 일치하지만 해당 항목은 **`unreferenced`로 잘못 분류**돼 있다. 비교값은 원본 경로를 기록하지 않기 위한 식별 수단이며 보안용 무결성 해시로 사용하지 않는다.

백업 코드 `workers/storage-backup/src/storageBackup.ts`는 `legacy_url`에서 `image_url`, `private_path`에서 `image_path`를 조회한다. 로컬 후속 계약과 설정은 `private_path`를 요구한다. 실제 최신 스냅샷의 `legacy_url`은 현재 운영 DB 참조 방식과 맞지 않는다. 현재 사진 항목이 manifest에 있다는 사실은 확인했으므로 사진이 백업에서 사라졌다고 판정하지 않는다. 그러나 참조 분류·복원 목록은 신뢰할 수 없어 관찰 완료를 보류한다. 이 manifest의 미참조 3개를 사진 삭제 목록으로 사용하면 안 된다.

원본 경로를 제외한 검증 집계는 `output/ops-recheck-backup-20261002.json`에 있다. 다음 단계는 실제 배포된 Worker의 코드·binding을 확인하고 승인된 `private_path` 계약에 맞춰 보완한 뒤, 새 실제 예약 백업에서 DB 참조와 manifest 분류·본문 무결성·복구를 확인하는 것이다. Ops12 원본·고아 파일 정리는 계속 별도 보존 및 정확한 삭제 목록 확인을 따른다.

## Supabase 로그와 보안 기준

- 읽기 전용 집계에서 삭제 작업 2개는 모두 `completed`/`finalize`이며 진행·대기·재시도·실패 상태는 없다. 이는 신규 휴지통 정리의 성공 증거가 아니다.
- `inventory_import_jobs`, `cabinet_trash` 테이블은 운영에 없다. 로컬 신규 마이그레이션이 운영에 적용됐다고 간주하지 않는다.
- 로그 확인창은 `2026-10-01 01:37:34~2026-10-02 01:37:34 KST`다. Edge 17개와 Storage 13개는 모두 HTTP 200이며 PostgreSQL 19개는 모두 LOG다. pgbouncer 36개와 postgrest 2개는 이 집계에서 심각도가 확인되지 않아 전체 오류 0으로 확대 해석하지 않는다.
- 보안 Advisor는 INFO `rls_enabled_no_policy` 15개, WARN `authenticated_security_definer_function_executable` 45개다. 규칙·레벨·스키마·이름·함수 인수로 비교했을 때 `supabase/security-advisors/production.json`의 승인 기준 60개와 일치하며 추가·누락은 0이다. 기존 경고가 해소됐다는 의미는 아니다.

## 후속 판정

웹 공개 경계와 확인한 Pages 오류 집계는 통과했다. 백업 manifest 해시 연결은 통과했으나 사진 참조 분류가 실패했으므로 기존 관찰을 전체 정상 완료로 표시하지 않는다. 캐비넷 작업은 계속 준비할 수 있으나 운영 출시 전 백업 참조 모드, 현재 스케줄러 성공·유지보수 활성화 절차, 같은 후보 SHA의 Quality·Staging·DB 권한 검증을 해결해야 한다. 기간만 지나거나 과거 `enablement_eligible` 값이 true라는 이유로 완료 처리하지 않는다.

## 승인된 후속 출시 작업과 재조회

- 후보 `d884feb8846e77af166b7613db088674acb6abae`의 [실제 Quality 실행](https://github.com/haengjoo123/buril-lab/actions/runs/36898429564)은 Application checks, Cloudflare release contract, Blank database interface, Gate 0 browser interface 모두 성공했다. 이는 해당 SHA의 증거이며 이후 Advisor 계약을 포함한 후보에는 새로운 Quality 실행이 필요하다.
- Staging 프로젝트 `qpgnomuqdcucjmxrunnw`에 import, cabinet trash/revision, import service grants 마이그레이션 3개를 적용하고 정확한 소스를 migration history에 저장했다. 운영 프로젝트에는 적용하지 않았다. Staging 53개 공개 테이블과 적용 버전 `20261002010000`을 확인했다.
- 실제 Staging에서 baseline·신규 권한 96개·캐비넷 복원/만료·Ops5~11 SQL fixture와 가져오기 기본 소유권·입력 검증·재시도·source 보존 fixture가 통과했다. rollback fixture의 시험 사용자·작업 및 실행 중인 10k 쿼리가 0개인 것을 확인했다. 10,000행 전체를 단일 관리 API 요청으로 실행하는 방식은 DB statement timeout과 HTTP 524로 완료 증거를 얻지 못했다. 전체 행수와 재시도 조건을 유지한 100행별 transaction 검증을 별도로 수행해야 한다.
- Staging Advisor는 기존 60개 기술 항목의 변경·누락 없이 신규 authenticated SECURITY DEFINER WARN 8개를 더해 68개다. 신규 RPC 모두 anon/service_role 실행은 false, authenticated 실행만 true다. 추가 항목은 함수별 서명·권한·검토 이유와 만료를 기록한 `temporary_open`이며 경고 해소로 해석하지 않는다.
- `production.json`은 실제 기존 관측 60개를 유지한다. 배포 검증기는 기존 60개와 Staging에서 관측·검토한 정확한 신규 RPC 8개로 **운영 마이그레이션 이후 기대값 68개**를 구성한다. 기존 항목 변화, 미승인 RPC, 추가 역할 권한 및 마이그레이션 미적용 상태는 거부한다. 이 기대값을 운영에서 관측했다고 기록하지 않는다.
- 격리 작업 트리의 Wrangler 인증으로 운영 KV를 다시 읽었다. 유지보수·삭제 접수 OFF, 사진 백업 ON이며 health 마지막 성공은 여전히 9월 18일이다. 원래 작업 트리의 KV 401을 모든 인증이 만료됐다는 근거로 확대하지 않는다. 공개 `release.json`도 기존 `0a17f695...`다.
- 02:45:18 KST에 새 예약 백업 `20261001t174514596z-91674f293713dbb7b6d4f7c7`이 완료됐다. latest·complete·sidecar·다운로드한 1,558-byte manifest의 SHA-256은 모두 `416c57696bd19c722dca52e4a8891e527267ea4fdf334ab5209fac5c57614184`로 일치한다. 여전히 `legacy_url`, 전체 3/참조 0/미참조 3, 총 3,794,343 bytes다. 예약 백업 성공이 사진 참조 분류 문제를 해결한 것은 아니다.
- GitHub Staging·Production 환경에는 새 임시 Supabase PAT 및 Pages/Worker 배포 토큰이 없다. 기존 배포 계약은 감독 스크립트의 숨김 입력, 서명된 lease, 공급자 폐기와 cleanup receipt를 요구한다. 기존 로그인 인증을 GitHub 임시 토큰 대신 재사용하지 않는다. 이 확인으로 Pages/Worker 배포 또는 운영 DB 적용을 완료했다고 주장하지 않는다.
