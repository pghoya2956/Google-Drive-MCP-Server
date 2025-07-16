# MCP Google Drive 서버

지정된 폴더 범위 내에서 Google Drive 파일과 Google Sheets에 대한 안전하고 범위가 지정된 액세스를 제공하는 Model Context Protocol (MCP) 서버입니다. 이 서버를 통해 AI 어시스턴트가 Google Drive 콘텐츠와 상호작용할 수 있습니다.

## 드라이브 접근 범위

이 서버는 내 드라이브와 공유 드라이브 모두 지원합니다. `GDRIVE_ROOT_FOLDER_ID`로 지정된 폴더와 그 하위 폴더에만 접근합니다.

- **내 드라이브**: 특정 폴더 ID를 설정하면 해당 폴더 이하만 접근
- **공유 드라이브**: 공유 드라이브 내 폴더 ID를 설정하면 해당 범위만 접근
- **API 설정**: `supportsAllDrives: true`로 모든 드라이브 유형 지원

## 기능
- **파일 작업**: Google Docs, Sheets 및 일반 파일 읽기
- **검색 기능**: 허용된 범위 내에서 파일 검색
- **Sheets 통합**: Google Sheets 셀 읽기 및 업데이트
- **보안**: Google API를 사용한 OAuth2 인증
- **오류 처리**: 지원되지 않는 파일 유형에 대한 우아한 처리

## 사용 가능한 도구

### 파일 관리
- **`gdrive_search`**: Google Drive 파일 검색 (`query`, `pageToken`, `pageSize`)
- **`gdrive_read_file`**: 파일 내용 읽기 (`fileId`)
- **`gdrive_read_large_file`**: 대용량 파일 읽기 (`fileId`, `startLine`, `endLine`)
- **`gdrive_folder_structure`**: 폴더 구조 탐색 (`folderId`)
- **`gdrive_analyze_image`**: 이미지 분석 (`fileId`, `prompt`)

### 스프레드시트
- **`gsheets_read`**: 시트 데이터 읽기 (`spreadsheetId`, `ranges`, `sheetId`)
- **`gsheets_update_cell`**: 셀 업데이트 (`fileId`, `range`, `value`)

### 지원 파일 유형
- Google Docs → Markdown
- Google Sheets → CSV
- Google Slides → 텍스트
- Google Drawings → PNG
- 일반 파일 (텍스트/바이너리)

## 설치

```bash
npm install @pghoya2956/gdrive-mcp-server
```

## 구성

### 환경 변수

프로젝트 루트에 다음 변수를 포함한 `.env` 파일을 생성합니다:

```env
CLIENT_ID=your-oauth-client-id
CLIENT_SECRET=your-oauth-client-secret
GDRIVE_CREDS_DIR=/path/to/credentials/directory
GDRIVE_ROOT_FOLDER_ID=your-root-folder-id
```

**환경 변수 역할:**
- `CLIENT_ID`, `CLIENT_SECRET`: 토큰 갱신 시 사용 (gcp-oauth.keys.json의 값과 동일)
- `GDRIVE_CREDS_DIR`: 인증 파일들이 저장되는 디렉토리 경로
- `GDRIVE_ROOT_FOLDER_ID`: 접근을 제한할 루트 폴더 ID

### Google Cloud 시작하기

1. **[새 Google Cloud 프로젝트 생성](https://console.cloud.google.com/projectcreate)**

2. **[필요한 API 활성화](https://console.cloud.google.com/workspace-api/products):**
   - Google Drive API
   - [Google Sheets API](https://console.cloud.google.com/apis/api/sheets.googleapis.com/)
   - [Google Docs API](https://console.cloud.google.com/marketplace/product/google/docs.googleapis.com)

3. **[OAuth 동의 화면 구성](https://console.cloud.google.com/apis/credentials/consent)**
   - 조직 내에서 테스트하려면 "내부"를 선택
   - 다음 OAuth 범위를 추가:
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/spreadsheets`

4. **[OAuth 클라이언트 ID 생성](https://console.cloud.google.com/apis/credentials/oauthclient)**
   - 애플리케이션 유형: "데스크톱 앱"
   - 클라이언트의 OAuth 키 JSON 파일 다운로드

5. **자격 증명 설정:**
   - 다운로드한 키 파일의 이름을 `gcp-oauth.keys.json`으로 변경
   - `GDRIVE_CREDS_DIR` 디렉토리에 배치 (예: `/Users/username/.config/gdrive-mcp-server`)
   - 이 파일은 최초 인증 시에만 사용되며, 브라우저 인증 흐름을 시작합니다

6. **환경 변수 설정:**
   - `gcp-oauth.keys.json`에서 client_id와 client_secret 값을 확인
   - 이 값들을 환경 변수 `CLIENT_ID`, `CLIENT_SECRET`에 설정
   - 토큰 자동 갱신에 필요합니다

7. **루트 폴더 ID 찾기:**
   - 루트로 사용할 Google Drive 폴더 열기
   - 폴더 ID는 URL에 있습니다: `https://drive.google.com/drive/folders/[FOLDER_ID]`

## MCP 클라이언트 구성

### Claude Desktop

`claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": ["@pghoya2956/gdrive-mcp-server"],
      "env": {
        "CLIENT_ID": "your-oauth-client-id",
        "CLIENT_SECRET": "your-oauth-client-secret",
        "GDRIVE_CREDS_DIR": "/path/to/credentials/directory",
        "GDRIVE_ROOT_FOLDER_ID": "your-root-folder-id"
      }
    }
  }
}
```

## 인증 흐름

1. **최초 실행**: 브라우저가 열리며 Google 계정 인증
2. **토큰 저장**: `.gdrive-server-credentials.json`에 자동 저장
3. **자동 갱신**: 토큰 만료 시 자동으로 갱신

## 사용 예시

구성이 완료되면 자연어를 사용하여 Google Drive와 상호작용할 수 있습니다:

- "프로젝트 제안서가 포함된 문서 검색"
- "분기별 보고서의 내용 읽기"
- "예산 스프레드시트의 A1 셀을 5000으로 업데이트"
- "내 드라이브의 모든 스프레드시트 보기"

## 보안 고려사항

- 서버는 지정된 루트 폴더와 하위 폴더 내의 파일에만 액세스할 수 있습니다
- Drive 파일에 대해 읽기 전용 액세스 사용 (업데이트를 허용하는 Sheets 제외)
- OAuth 토큰은 자격 증명 디렉토리에 로컬로 저장됩니다
- 자격 증명이나 토큰을 버전 관리에 커밋하지 마세요

## 문제 해결

### 일반적인 문제

1. **"GDRIVE_ROOT_FOLDER_ID 환경 변수가 필요합니다"**
   - 환경이나 구성에서 `GDRIVE_ROOT_FOLDER_ID`를 설정했는지 확인하세요

2. **"이 유형의 Google Apps 파일을 읽을 수 없습니다"**
   - 일부 Google Apps 파일(Forms, Sites 등)은 내보낼 수 없습니다
   - Docs, Sheets, Slides, Drawings만 지원됩니다

3. **인증 오류**
   - `.gdrive-server-credentials.json`을 삭제하고 다시 인증하세요
   - OAuth 클라이언트가 올바르게 구성되었는지 확인하세요

4. **"파일이 허용된 폴더 범위를 벗어났습니다"**
   - 파일이 구성된 루트 폴더 내에 없습니다
   - 파일이 올바른 폴더 계층 구조에 있는지 확인하세요

## 개발

### 소스에서 빌드
```bash
# 저장소 복제
git clone https://github.com/pghoya2956/gdrive-mcp-server.git
cd gdrive-mcp-server

# 종속성 설치
npm install

# TypeScript 빌드
npm run build

# 개발 모드로 실행
npm run watch
```

## 라이센스

이 프로젝트는 [이 저장소](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive)에서 MIT 라이센스로 배포된 Anthropic, PBC가 원래 개발한 코드를 포함합니다.

## 기여

기여를 환영합니다! Pull Request를 자유롭게 제출해 주세요.
