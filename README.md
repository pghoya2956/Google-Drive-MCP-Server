# MCP Google Drive 서버

지정된 폴더 범위 내에서 Google Drive 파일과 Google Sheets에 대한 안전하고 범위가 지정된 액세스를 제공하는 Model Context Protocol (MCP) 서버입니다. 이 서버를 통해 AI 어시스턴트가 Google Drive 콘텐츠와 상호작용할 수 있습니다.

## 기능

- **범위 지정 액세스**: `GDRIVE_ROOT_FOLDER_ID`를 사용하여 특정 Google Drive 폴더와 하위 폴더에 대한 액세스 제한
- **파일 작업**: Google Docs, Sheets 및 일반 파일 읽기
- **검색 기능**: 허용된 범위 내에서 파일 검색
- **Sheets 통합**: Google Sheets 셀 읽기 및 업데이트
- **보안**: Google API를 사용한 OAuth2 인증
- **오류 처리**: 지원되지 않는 파일 유형에 대한 우아한 처리

## 사용 가능한 도구

### 1. `gdrive_search`
허용된 폴더 범위 내에서 Google Drive의 파일을 검색합니다.

**매개변수:**
- `query`: 검색 쿼리 문자열
- `pageToken`: 페이지네이션을 위한 토큰 (선택사항)
- `pageSize`: 페이지당 결과 수, 최대 100 (선택사항)

### 2. `gdrive_read_file`
Google Drive에서 파일 내용을 읽습니다.

**매개변수:**
- `fileId`: 읽을 파일의 ID

**지원되는 파일 유형:**
- Google Docs (Markdown으로 내보내기)
- Google Sheets (CSV로 내보내기)
- Google Slides (일반 텍스트로 내보내기)
- Google Drawings (PNG로 내보내기)
- 일반 파일 (텍스트 및 바이너리)

### 3. `gsheets_read`
유연한 범위 옵션으로 Google 스프레드시트에서 데이터를 읽습니다.

**매개변수:**
- `spreadsheetId`: 스프레드시트의 ID
- `ranges`: A1 표기법 범위의 배열 (선택사항)
- `sheetId`: 읽을 특정 시트 ID (선택사항)

### 4. `gsheets_update_cell`
Google 스프레드시트의 셀 값을 업데이트합니다.

**매개변수:**
- `fileId`: 스프레드시트의 ID
- `range`: A1 표기법의 셀 범위 (예: 'Sheet1!A1')
- `value`: 새 셀 값

## 설치

1. 이 저장소를 복제합니다:
```bash
git clone https://github.com/yourusername/mcp-gdrive.git
cd mcp-gdrive
```

2. 종속성을 설치합니다:
```bash
npm install
```

3. 프로젝트를 빌드합니다:
```bash
npm run build
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
   - `GDRIVE_CREDS_DIR` 디렉토리에 배치 (예: `/Users/username/.config/mcp-gdrive`)

6. **Google Cloud Console 자격 증명 페이지에서 OAuth 클라이언트 ID와 클라이언트 시크릿을 기록**

7. **루트 폴더 ID 찾기:**
   - 루트로 사용할 Google Drive 폴더 열기
   - 폴더 ID는 URL에 있습니다: `https://drive.google.com/drive/folders/[FOLDER_ID]`

## MCP 클라이언트 구성

MCP 클라이언트 구성에 이 서버를 추가합니다:

### Claude Desktop

`claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "node",
      "args": ["/path/to/mcp-gdrive/dist/index.js"],
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

1. 첫 실행 시 Google 인증을 요청합니다
2. OAuth 흐름을 완료하기 위해 브라우저가 열립니다
3. 요청된 권한을 부여합니다
4. 자격 증명이 `GDRIVE_CREDS_DIR/.gdrive-server-credentials.json`에 저장됩니다
5. 이후 실행 시 저장된 자격 증명을 사용합니다
6. 토큰은 필요 시 자동으로 갱신됩니다

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

```bash
# 종속성 설치
npm install

# TypeScript 빌드
npm run build

# 테스트 실행 (사용 가능한 경우)
npm test
```

## 라이센스

이 프로젝트는 [이 저장소](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive)에서 MIT 라이센스로 배포된 Anthropic, PBC가 원래 개발한 코드를 포함합니다.

## 기여

기여를 환영합니다! Pull Request를 자유롭게 제출해 주세요.
