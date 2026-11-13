# 재고 SDS 파일 첨부 출시 절차

상태: Staging DB 적용·검증 완료, 운영 DB 미적용 (2026-11-13)

## 2026-11-13 적용 기록

- Staging에 적용했고 `inventory_sds_documents_behavior.sql` 9건을 롤백 트랜잭션으로 실행해 모두 통과했다. 시험 데이터는 남지 않았다.
- Staging Security Advisor는 79건에서 81건(새 공개 RPC 2개)으로 늘었고 다른 새 항목은 없었다. 두 환경의 기준선을 81건으로 갱신했다.
- 운영 적용은 자동 모드 권한 확인에서 거부되어 아직 하지 않았다. **운영에 적용하기 전에는 이 브랜치를 병합하지 않는다.** 병합하면 운영 hosted 검사가 기준선과 달라 실패한다. 반대로 Staging만 적용된 지금 `main`에 다른 변경이 병합되면 Staging hosted 검사가 실패한다.

## 무엇이 바뀌나

- 재고 상세에 "보관 중인 SDS 파일" 구역이 생긴다. 공급사 SDS(PDF·PNG·JPG, 20MB 이하)를 올리고, 열고, 지운다.
- 문서는 병이 아니라 **제품**에 붙는다. 같은 공간에서 CAS 번호가 같거나, 제품번호가 같고 브랜드가 서로 다르지 않은 모든 재고에 같은 파일이 보인다.
- CAS 번호도 제품번호도 없는 재고에는 올릴 수 없다(먼저 재고 정보를 수정하도록 안내).
- 기존 KOSHA MSDS 보기와 제조사 SDS 링크는 그대로 둔다.

## 서버가 강제하는 규칙

`20261114090000_inventory_sds_documents.sql` (추가형, 새 테이블 1개, 새 비공개 버킷 1개)

- 버킷 `inventory-sds`: 비공개, 20MB, PDF·PNG·JPEG만. 객체 이름은 `<공간 폴더>/<파일>`이고 공간 폴더는 연구실 id 또는 개인 공간의 `u-<사용자 id>`다. 해당 공간 구성원만 읽기·올리기·지우기가 가능하다(`private.can_use_sds_object_v1`).
- 테이블 `inventory_sds_documents`: 연구실 멤버(개인 공간은 본인)만 읽는다. `authenticated`는 SELECT만 가진다.
- `create_inventory_sds_document_v1`: 호출자가 자기 공간 폴더에 이미 올린 객체만 등록한다. 형식과 크기는 클라이언트가 아니라 저장된 객체의 메타데이터에서 읽는다. CAS 번호 형식을 검사하고, CAS 번호나 제품번호 중 하나를 요구한다.
- `delete_inventory_sds_document_v1`: 올린 사람, 연구실 관리자, 개인 공간 소유자만. 기록을 지우고 파일 경로를 돌려주면 클라이언트가 파일을 지운다.
- 삭제 연동: `prepare_deletion_job_database_v1`을 다시 정의해 연구실 삭제 시 그 연구실 폴더의 SDS 파일을, 계정 삭제 시 개인 폴더의 SDS 파일과 기록을 기존 삭제 대기열에 넣는다. 실험 도구 이미지 단계(20261109011747)는 그대로 유지했다. 삭제 Worker의 허용 버킷에 `inventory-sds`를 추가했다.
- 공개 테이블이 1개 늘어 `baseline_permissions.sql`의 기대 개수를 58/41/58로 갱신했다.

## 알려진 한계

- 등록 RPC가 실패하면 클라이언트가 올린 파일을 지운다. 그 삭제마저 실패하면 기록 없는 파일이 공간 폴더에 남는다(같은 공간 구성원만 볼 수 있다). 기록 삭제 뒤 파일 삭제가 실패해도 마찬가지다.
- 문서의 개정일·버전 관리, 만료(3년 경과 등) 알림은 없다.
- 감사 로그에 SDS 업로드·삭제를 남기지 않는다.

## 클라이언트

- 플래그 `VITE_ENABLE_SDS_ATTACHMENTS`(기본 `false`). DB 적용 전에 켜면 SDS 구역이 "불러오지 못했습니다"로 표시되고 다른 화면에는 영향이 없다.

## 검증

- `src/features/inventorySds/sdsDatabase.test.ts`: 이 migration을 내장 PostgreSQL에서 실제로 실행한다. Storage·연구실·삭제 Worker 테이블은 최소 대역이다. 공간별 업로드 허용·거부, 경로 이탈 거부, 저장된 객체 기준 등록, 없는 파일·다른 공간·잘못된 CAS 거부, 다른 연구실의 조회·삭제 거부, 관리자·업로더 삭제, 연구실·계정 삭제 시 대기열 등록과 도구 이미지 단계 유지를 확인한다.
- pgTAP `inventory_sds_documents_behavior.sql`(9건)은 PR의 `Blank database interface` 검사와 Staging 적용 시 실행한다.

## 출시 순서

1. Staging과 운영에 같은 SQL을 이어서 적용하고, 두 환경의 Security Advisor 기준선을 같은 PR에서 갱신한다(예상: 새 공개 RPC 2개로 WARN 2건 증가). 한 환경만 적용한 채로 두면 Web release의 hosted 검사가 실패한다.
2. Staging에서 pgTAP을 롤백 트랜잭션으로 실행한다.
3. 플래그를 켠 Staging 빌드로 확인한다: 업로드 → 같은 CAS의 다른 병에서 표시 → 열기 → 다른 멤버의 삭제 거부 → 관리자 삭제.

## 되돌리기

- 즉시: 플래그를 `false`로 재배포한다.
- DB: `prepare_deletion_job_database_v1`을 20261109011747의 정의로 되돌린 뒤 RPC·정책·테이블·버킷을 제거한다. 버킷의 파일을 먼저 지워야 한다.
