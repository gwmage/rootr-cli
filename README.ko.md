# rootr-cli

Rootr(마크다운 지식협업 SaaS) 공식 CLI + MCP 서버. 에이전트나 사람이 Rootr 문서를
로컬 파일처럼 읽고/쓰고/검색할 수 있게 해줍니다.

> English documentation: [README.md](README.md)

- `rootr` CLI: `ls`, `read`, `write`, `append`, `edit`, `search`, `ws`, `ask`, `config`
- `rootr mcp`: stdio 기반 MCP 서버 (Claude Code / Claude Desktop 등에 등록해서 사용), **도구 81종**
  — 문서 12 + 워크스페이스/스캐폴딩 4 + DB 5 + 스프레드시트 7 + 화이트보드 3 + 폼 7
  + 프레젠테이션 6 + 이미지 2 + 이슈 6 + CRM 18 + LOG 5 + ask 1 + 웹훅 3 + 버전/삭제 2

순수 Node.js ESM, 빌드 과정 없음. Node 18 이상 필요(내장 `fetch` 사용).

## 링크

- 소스: https://github.com/gwmage/rootr-cli
- npm: https://www.npmjs.com/package/rootr-cli
- 원격 커넥터(설치 없이 바로 연결): `https://rootr.io/mcp` — Claude Code/Desktop 등에서
  로컬 CLI 설치 없이 원격 MCP 엔드포인트로 바로 연결할 수 있습니다. 로컬 CLI(`rootr mcp`)와
  기능은 동일하며, 자체 인프라에 CLI를 두고 싶을 때만 이 저장소를 설치하면 됩니다.
- 라이선스: MIT (`LICENSE` 참고)

## 설치

이 저장소 안에서 바로 실행하거나, 전역 설치할 수 있습니다.

```bash
# 설치 없이 바로 실행
npx rootr-cli mcp

# 전역 설치
npm install -g rootr-cli
rootr --help

# 이 저장소를 클론해서 쓰는 경우
npm install
node bin/rootr.js --help

# 도커
docker build -t rootr-cli .
docker run -i --rm -e ROOTR_API_KEY=rootr_xxx -e ROOTR_WORKSPACE=ws_123 rootr-cli
```

## 설정

우선순위: **환경변수 > `~/.rootr/config.json`**

| 환경변수 | 설정파일 키 | 설명 |
|---|---|---|
| `ROOTR_API_KEY` | `apiKey` | `rootr_...` 형태의 API 키. 모든 요청에 `x-api-key` 헤더로 전송됩니다. |
| `ROOTR_WORKSPACE` | `workspace` | 워크스페이스 id |
| `ROOTR_BASE_URL` | `baseUrl` | 기본값 `https://rootr.io/api/v1` |

설정 파일에 저장하기:

```bash
rootr config --api-key rootr_xxxxxxxxxxxxxxxx --workspace ws_123
# 필요하면 온프레미스/개발 서버용 base-url도 지정 가능
rootr config --api-key rootr_xxx --workspace ws_123 --base-url https://dev.rootr.io/api/v1
```

`~/.rootr/config.json`은 `chmod 600`으로 생성됩니다.

### 키 2종

Rootr API 키는 두 종류가 있고, 도구별로 요구하는 종류가 다릅니다.

- **워크스페이스 키**: 특정 워크스페이스 안에서만 동작. 스코프는
  `docs:read`/`docs:write`/`graph:read`/`ask`/`webhooks:manage` 중 일부.
  대부분의 문서/LOG/이슈/웹훅/ask 도구는 이 키로 충분합니다.
- **계정 키 (PAT)**: 사용자 계정 전체로 동작. `workspaces:create` 스코프가 있으면
  새 워크스페이스를 만들 수 있습니다 (`rootr_create_workspace`). 워크스페이스 키로
  워크스페이스 생성을 시도하면 403과 함께 계정 키가 필요하다는 힌트가 출력됩니다.

현재 설정 확인 (API 키는 앞 12자만 표시):

```bash
rootr config
# config file: /home/you/.rootr/config.json
# apiKey:      rootr_abcd...
# workspace:   ws_123
# baseUrl:     https://rootr.io/api/v1
```

## CLI 사용법

경로 인자 규칙: `/`로 시작하면 **경로**로 취급되어 by-path API로 노드 id를 알아냅니다
(워크스페이스 설정 필요). `/`로 시작하지 않으면 **노드 id**로 취급합니다.

### 트리 조회

```bash
rootr ls                # 전체 트리
rootr ls /notes         # /notes 하위만
```

출력: `TYPE\tpath` 형식, 경로 정렬.

### 문서 읽기

```bash
rootr read /notes/todo.md          # 마크다운 원문을 stdout으로
rootr read /notes/todo.md --json   # 메타데이터 포함 JSON 전체
rootr read <nodeId>                # id로도 가능
```

### 문서 쓰기 (전체 교체, 없으면 생성)

```bash
echo "# 제목" | rootr write /notes/new.md
rootr write /notes/new.md --file ./local.md
rootr write <nodeId> --file ./local.md --if-match "\"abc123\""   # 낙관적 동시성 제어
```

경로가 아직 없으면 자동으로 문서를 생성합니다(`createParents: true`).
`--if-match`를 지정했는데 그 사이 문서가 바뀌었으면 412 오류와 함께
"문서가 그 사이 변경됨: 다시 읽고 재시도" 힌트가 출력됩니다.

### 안전하게 추가 (append) — 충돌 걱정 없는 기본 수단

```bash
rootr append /notes/log.md "오늘 배포 완료"
rootr append /notes/log.md "- 항목 하나 더" --heading "## 할 일"
cat diff.md | rootr append /notes/log.md
rootr append /notes/log.md --file ./chunk.md
```

`--heading`을 지정하면 해당 헤딩 섹션 끝에 추가되고, 없으면 문서 끝에 추가됩니다.
append는 전체 내용을 다시 쓰지 않으므로 다른 프로세스와 동시에 써도 충돌하지 않습니다.

### 텍스트 치환 (edit)

```bash
rootr edit /notes/todo.md --find "- [ ] 배포" --replace "- [x] 배포"
rootr edit /notes/todo.md --find "TODO" --replace "DONE" --all
```

`--find`한 텍스트가 없거나 여러 번 나타나면(고유하지 않으면) 서버가 409를 반환하고
그 이유가 그대로 출력됩니다. `--all`을 주면 모든 일치 항목을 치환합니다.

### 검색

```bash
rootr search "배포 절차"
```

출력: `path — snippet` 목록.

### 워크스페이스 목록

```bash
rootr ws
```

출력: `id\tname` 목록 (계정 키면 소속된 전체 워크스페이스, 워크스페이스 키면 그 워크스페이스만).

### RCA 질의응답 (ask)

```bash
rootr ask "지난주 배포 후 지연이 왜 늘었어?"
rootr ask "왜 결제 실패가 늘었지?" --workspace ws_123
```

워크스페이스의 지식그래프(GraphRAG)에 질문하고 답변 본문 + 인용(문서 경로: 인용문)을 출력합니다.
`ask` 스코프가 필요합니다. `--workspace`를 생략하면 설정된 기본 워크스페이스를 사용합니다.

## MCP 서버로 사용하기

`rootr mcp`는 stdio로 MCP(Model Context Protocol) 서버를 구동합니다. 제공 도구 **81종**.
아래 표는 주요 그룹만 정리한 것이고, 전체 목록은 [README.md의 MCP tools 표](README.md#mcp-tools)를
보거나 서버에 `tools/list`를 호출하면 됩니다.

#### 문서 (workspace 키, docs:read/docs:write)

| 도구 | 설명 |
|---|---|
| `rootr_list` | 워크스페이스 트리 목록 |
| `rootr_read` | 문서 마크다운 읽기 |
| `rootr_append` | **(권장)** 문서에 안전하게 추가 — 충돌 불가능 |
| `rootr_edit` | 정확한 텍스트 스니펫 치환 |
| `rootr_write` | 문서 전체 교체(파괴적) 또는 신규 생성 |
| `rootr_search` | 워크스페이스 검색 |

에이전트에게는 가능하면 `rootr_append`/`rootr_edit`을 우선 사용하고,
`rootr_write`는 정말 전체를 다시 쓸 때만 (가능하면 `ifMatch`와 함께) 쓰도록
각 도구 설명에 명시되어 있습니다.

#### 워크스페이스 / 스캐폴딩

| 도구 | 필요 스코프 | 설명 |
|---|---|---|
| `rootr_workspaces` | 계정 키 또는 워크스페이스 키 | 내 워크스페이스 목록 |
| `rootr_scaffold_plan` | 워크스페이스 불필요 | 의도(intent) 문장으로 문서 트리 계획 생성 |
| `rootr_create_workspace` | **계정 키(PAT) + workspaces:create** | 계획된 트리로 새 워크스페이스 생성 |
| `rootr_scaffold_apply` | docs:write | 기존 워크스페이스에 트리 적용 |

#### LOG 데이터스토어 (docs:read/docs:write)

| 도구 | 설명 |
|---|---|
| `rootr_create_log_store` | 타입드 LOG 스토어 생성 (필드: string/int/float/bool/datetime/json/enum/level/relation) |
| `rootr_update_log_fields` | 필드 스키마 갱신 — **전체 교체**(유지할 필드도 다시 보내야 함) |
| `rootr_add_log_entries` | 엔트리(행) 추가 |
| `rootr_query_log_entries` | 엔트리 조회/필터(시간범위·source·level·anomalyOnly) |
| `rootr_log_stats` | 집계 통계(hour/day/source/level × count/avg/max/min/sum) |

#### RCA 질의응답 (ask 스코프)

| 도구 | 설명 |
|---|---|
| `rootr_ask` | 지식그래프(GraphRAG)에 자연어 질문, 답변+인용 반환 |

#### 이슈 트래커 (docs:read/docs:write)

| 도구 | 설명 |
|---|---|
| `rootr_create_issue_tracker` | 이슈 트래커 생성 |
| `rootr_list_issues` | 이슈 목록(state/label/type/assignee/검색어 필터) |
| `rootr_create_issue` | 이슈 생성(labels/type/parentIssueId 지원) |
| `rootr_get_issue` | 이슈 상세 조회 |
| `rootr_update_issue` | 이슈 갱신(닫기: state=CLOSED + stateReason) |
| `rootr_comment_issue` | 이슈에 댓글 추가 |

#### 웹훅 (webhooks:manage 스코프)

| 도구 | 설명 |
|---|---|
| `rootr_list_webhooks` | 워크스페이스 웹훅 목록 |
| `rootr_create_webhook` | 웹훅 생성 — 응답의 secret은 **1회만 노출** |
| `rootr_delete_webhook` | 웹훅 삭제 |

#### 문서 버전 / 삭제

| 도구 | 설명 |
|---|---|
| `rootr_document_versions` | 문서 버전 히스토리 조회 |
| `rootr_delete_node` | 노드를 휴지통으로 이동(복구 가능) |

#### 프레젠테이션 (docs:write)

MCP 도구 6종(`rootr_create_presentation` / `read` / `update` / `append_presentation_slides` /
`update_presentation_slide` / `reorder_presentation_slides`)이 있고, 같은 API 키로 REST를
직접 호출해도 됩니다 (`x-api-key` 헤더, `docs:write`):

```bash
# 덱 생성 (슬라이드 포함 가능)
curl -X POST "$BASE/workspaces/$WS/presentations" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"제안서","slides":[{"id":"SLD-001","kind":"cover","title":"..."}]}'

# 슬라이드 부분 수정(머지) / 추가 / 순서 변경
curl -X PATCH "$BASE/presentations/$ID/slides/SLD-001" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' -d '{"slide":{"notes":"발표 대본"}}'
curl -X POST "$BASE/presentations/$ID/slides"  -d '{"slides":[...]}' ...
curl -X POST "$BASE/presentations/$ID/reorder" -d '{"order":["SLD-002","SLD-001"]}' ...
```

**고품질 덱을 만들 때는 슬라이드 `html` 필드에 1280×720 완결 HTML을 직접 구워
넣는 방식을 권장**합니다 — 뷰어가 기본 템플릿 대신 그대로 렌더합니다(완전 자유
디자인). 필수 규칙(외부 요청 차단이라 전부 인라인, 이미지=data URI 내장, 폰트
폴백 스택, `<span class="pn">`=페이지번호, 그래프용 텍스트(title/blocks/notes/alt)
병행 유지)은 **`/llms.txt`의 "Presentations" 섹션**에 정리돼 있습니다 — 저작 전에
꼭 읽어보세요. AI 이미지 생성은 `POST /v1/workspaces/:ws/images/generate`(AI
크레딧 차감)를 사용합니다.

모든 도구 설명은 영어(에이전트가 소비하는 스키마)로 작성되어 있고, JSON을 반환하는
도구는 보기 좋게 들여쓴 JSON 텍스트로 응답합니다. `workspace` 인자를 받는 도구는
생략 시 `ROOTR_WORKSPACE`/설정파일의 기본 워크스페이스를 사용하며, 그것도 없으면
명확한 에러를 반환합니다.

### Claude Code / Claude Desktop에 등록하기

`~/.claude.json`(Claude Code) 또는 Claude Desktop의 MCP 설정 파일에 다음을 추가:

```json
{
  "mcpServers": {
    "rootr": {
      "command": "node",
      "args": ["/path/to/rootr/backend/cli/bin/rootr.js", "mcp"],
      "env": {
        "ROOTR_API_KEY": "rootr_xxxxxxxxxxxxxxxx",
        "ROOTR_WORKSPACE": "ws_123"
      }
    }
  }
}
```

전역 설치했다면 `command`를 `"rootr"`, `args`를 `["mcp"]`로만 써도 됩니다.

## 에러 처리

API가 비-2xx를 반환하면 응답 본문의 `message`(있으면)를 stderr에 출력하고
exit code 1로 종료합니다. 상황별 힌트:

- `401`/`403` → API 키/워크스페이스 스코프 확인 안내
- `412` → "문서가 그 사이 변경됨: 다시 읽고 재시도" 안내 (If-Match 불일치)
- `409` → 서버가 준 이유 메시지를 그대로 표시 (예: edit의 find 불일치/중복)

## 개발 메모

- 의존성: `@modelcontextprotocol/sdk`(MCP 서버), `zod`(도구 입력 스키마).
  CLI 자체(`bin/rootr.js`, `lib/config.js`, `lib/client.js`, `lib/resolve.js`)는
  외부 의존성 없이 동작합니다.
- 빌드 스텝 없음 — 순수 ESM 자바스크립트.
- 파일 구성:
  - `bin/rootr.js` — 엔트리포인트, 명령 디스패치
  - `lib/config.js` — 설정 로드/저장
  - `lib/client.js` — Rootr REST API 클라이언트(문서/워크스페이스/스캐폴딩/LOG/ask/이슈/웹훅)
  - `lib/resolve.js` — path/id 타겟 해석 공통 로직
  - `lib/mcp.js` — MCP stdio 서버 진입점, 도구 모듈 조립
  - `lib/mcp-tools/shared.js` — MCP 도구 공통 헬퍼(textResult/jsonResult/errorResult/makeClient/requireWorkspace)
  - `lib/mcp-tools/documents.js` — 문서 도구 12종
  - `lib/mcp-tools/workspaces.js` — 워크스페이스/스캐폴딩 도구 4종
  - `lib/mcp-tools/databases.js` — DATABASE 행 도구 5종
  - `lib/mcp-tools/spreadsheets.js` — 스프레드시트 도구 7종
  - `lib/mcp-tools/whiteboards.js` — 화이트보드 도구 3종
  - `lib/mcp-tools/forms.js` — 폼 도구 7종
  - `lib/mcp-tools/presentations.js` — 프레젠테이션 6종 + 이미지 2종
  - `lib/mcp-tools/crm.js` — CRM 도구 18종
  - `lib/mcp-tools/logs.js` — LOG 데이터스토어 도구 5종
  - `lib/mcp-tools/ask.js` — RCA ask 도구 1종
  - `lib/mcp-tools/issues.js` — 이슈 트래커 도구 6종
  - `lib/mcp-tools/webhooks.js` — 웹훅 도구 3종
  - `lib/mcp-tools/misc.js` — 문서버전/삭제 도구 2종
