# MCP Google Drive 서버

지정된 폴더 범위 내에서 Google Drive 파일과 Google Sheets에 대한 안전하고 범위가 지정된 액세스를 제공하는 Model Context Protocol (MCP) 서버입니다. 이 서버를 통해 AI 어시스턴트가 Google Drive 콘텐츠와 상호작용할 수 있습니다.

## 드라이브 접근 범위

이 서버는 내 드라이브와 공유 드라이브 모두 지원합니다. `GDRIVE_ROOT_FOLDER_ID`로 지정된 폴더와 그 하위 폴더에만 접근합니다.

- **내 드라이브**: 특정 폴더 ID를 설정하면 해당 폴더 이하만 접근
- **공유 드라이브**: 공유 드라이브 내 폴더 ID를 설정하면 해당 범위만 접근
- **API 설정**: `supportsAllDrives: true`로 모든 드라이브 유형 지원

## 기능
- **파일 작업**: Google Docs, Sheets, PDF, Excel 및 일반 파일 읽기
- **검색 기능**: 허용된 범위 내에서 파일 검색
- **Sheets 통합**: Google Sheets 셀 읽기 및 업데이트
- **PDF 지원**: PDF 파일에서 텍스트 추출 및 메타데이터 분석 (캐싱 지원)
- **Excel 지원**: Excel 파일(.xlsx) 읽기 및 구조화된 데이터 추출 (캐싱 지원)
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
- PDF 파일 → 텍스트 추출 (메타데이터 포함)
- Excel 파일 (.xlsx) → 구조화된 JSON 데이터
- 일반 파일 (텍스트/바이너리)

## 설치

```bash
npm install @pghoya2956/google-drive-mcp-server
```

## 구성

### 환경 변수

프로젝트 루트에 다음 변수를 포함한 `.env` 파일을 생성합니다:

```env
CLIENT_ID=your-oauth-client-id
CLIENT_SECRET=your-oauth-client-secret
GDRIVE_CREDS_DIR=/path/to/credentials/directory
GDRIVE_ROOT_FOLDER_ID=your-root-folder-id
PDF_SIZE_LIMIT_MB=20
```

**환경 변수 역할:**
- `CLIENT_ID`, `CLIENT_SECRET`: 토큰 갱신 시 사용 (gcp-oauth.keys.json의 값과 동일)
- `GDRIVE_CREDS_DIR`: 인증 파일들이 저장되는 디렉토리 경로
- `GDRIVE_ROOT_FOLDER_ID`: 접근을 제한할 루트 폴더 ID
- `PDF_SIZE_LIMIT_MB`: PDF 파일 크기 제한 (기본값: 20, 최대: 100) - 선택사항

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
        "GDRIVE_ROOT_FOLDER_ID": "your-root-folder-id",
        "PDF_SIZE_LIMIT_MB": "20"
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
- "계약서 PDF 파일 읽어서 메타데이터 확인하기"
- "연간 보고서 PDF의 내용과 페이지 수 확인"

## PDF 파일 지원

### PDF 읽기 기능
- **텍스트 추출**: PDF 파일에서 텍스트 내용 추출
- **메타데이터**: 페이지 수, 파일 크기, 제목, 작성자, 생성일 등 정보 제공
- **구조화된 응답**: JSON 형식으로 텍스트와 메타데이터를 분리하여 제공
- **테이블 추출**: PDF 내 테이블 자동 감지 및 구조화 (Markdown/JSON 형식)
- **캐싱 지원**: LRU 캐시로 반복 요청 시 성능 향상
  - 캐시 크기: 100MB
  - 캐시 유효 시간: 30분
  - 파일 수정 시 자동 갱신

### PDF 제한사항
- **파일 크기**: 최대 20MB까지 지원
- **암호화된 PDF**: 비밀번호 보호 PDF는 지원하지 않음
- **스캔 문서**: 스캔된 이미지로만 구성된 PDF는 텍스트 추출 불가
- **OCR 미지원**: 이미지에서 텍스트 인식(OCR) 기능 없음

### PDF 예시 응답
```json
{
  "text": "PDF 문서의 텍스트 내용...",
  "metadata": {
    "pages": 15,
    "fileSize": 2097152,
    "title": "연간 보고서 2024",
    "author": "John Doe",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "version": "PDF-1.4",
  "tables": [
    {
      "index": 1,
      "headers": ["항목", "2023년", "2024년", "변화율"],
      "rows": [
        ["매출", "100억", "120억", "+20%"],
        ["영업이익", "20억", "25억", "+25%"]
      ],
      "markdown": "| 항목 | 2023년 | 2024년 | 변화율 |\n|---|---|---|---|\n| 매출 | 100억 | 120억 | +20% |\n| 영업이익 | 20억 | 25억 | +25% |"
    }
  ]
}
```

## 대용량 PDF 처리

### PDF 크기 제한
- 기본 제한: 20MB (환경변수 `PDF_SIZE_LIMIT_MB`로 조정 가능)
- 최대 제한: 100MB (메모리 제약)

### 크기별 처리 방법

#### 20MB 이하 (기본)
```bash
# gdrive_read_file 사용 - 완전한 PDF 파싱
# 텍스트, 테이블, 메타데이터 추출 가능
```

#### 20-100MB
```bash
# 환경변수 설정 후 gdrive_read_file 사용
PDF_SIZE_LIMIT_MB=50 npm start
```

#### 100MB 초과
```bash
# gdrive_read_large_file로 부분 읽기
# 주의: PDF 파싱 없음, 원본 내용만 반환
{
  "tool": "gdrive_read_large_file",
  "arguments": {
    "fileId": "your-file-id",
    "maxBytes": 10485760,  # 10MB씩 읽기
    "startByte": 0
  }
}
```

### 도구별 특징 비교
| 기능 | gdrive_read_file | gdrive_read_large_file |
|------|------------------|------------------------|
| PDF 텍스트 추출 | ✅ | ❌ |
| 테이블 추출 | ✅ | ❌ |
| 메타데이터 | ✅ | ❌ |
| 크기 제한 | PDF_SIZE_LIMIT_MB | 없음 (부분 읽기) |
| 캐싱 | ✅ | ❌ |

## Excel 파일 처리

### Excel 파일 지원
- **지원 형식**: .xlsx (Office 2007 이상)
- **구조화된 데이터**: 각 시트별로 헤더와 데이터를 JSON 형식으로 추출
- **다중 시트**: 모든 시트의 데이터를 한 번에 읽기
- **캐싱**: PDF와 동일한 캐싱 시스템 사용

### Excel 읽기 응답 형식
```json
{
  "sheetNames": ["Sheet1", "Sheet2"],
  "sheets": {
    "Sheet1": {
      "range": "A1:D10",
      "rowCount": 10,
      "columnCount": 4,
      "headers": ["Name", "Age", "Email", "City"],
      "data": [
        {
          "Name": "John Doe",
          "Age": 30,
          "Email": "john@example.com",
          "City": "New York"
        }
      ],
      "rawData": [
        ["Name", "Age", "Email", "City"],
        ["John Doe", 30, "john@example.com", "New York"]
      ],
      "csv": "Name,Age,Email,City\nJohn Doe,30,john@example.com,New York"
    }
  },
  "metadata": {
    "fileSize": 1048576,
    "sheetCount": 2
  }
}
```

### Excel vs Google Sheets
| 기능 | Excel 파일 (.xlsx) | Google Sheets |
|------|-------------------|---------------|
| 도구 이름 | gdrive_read_file | gsheets_read |
| 데이터 수정 | ❌ | ✅ |
| 특정 범위 읽기 | ❌ (전체 시트) | ✅ |
| 수식 결과 | ✅ | ✅ |
| 캐싱 | ✅ | ❌ |

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

### PDF 관련 문제

1. **"PDF 파일이 20MB를 초과합니다"**
   - PDF를 압축하거나 분할하여 20MB 이하로 만드세요
   - Google Drive API의 파일 크기 제한입니다

2. **"이 PDF는 암호로 보호되어 있습니다"**
   - PDF 파일의 비밀번호를 제거한 후 다시 시도하세요
   - 암호화된 PDF는 현재 지원하지 않습니다

3. **"이 PDF는 스캔된 이미지로 구성되어 있어 텍스트를 추출할 수 없습니다"**
   - OCR 기능을 사용해 텍스트를 추출한 PDF를 생성하세요
   - 현재 OCR 기능은 지원하지 않습니다

### Excel 관련 문제

1. **"Excel 파일이 20MB를 초과합니다"**
   - Excel 파일을 압축하거나 불필요한 시트를 제거하세요
   - 환경변수 `PDF_SIZE_LIMIT_MB`로 제한을 늘릴 수 있습니다

2. **"Excel 파싱 오류"**
   - .xlsx 형식으로 저장되었는지 확인하세요
   - 파일이 손상되지 않았는지 확인하세요
   - .xls (구버전) 형식은 지원하지 않습니다

3. **"gsheets_read가 Excel 파일에서 작동하지 않습니다"**
   - gsheets_read는 Google Sheets 전용입니다
   - Excel 파일은 gdrive_read_file을 사용하세요

## 개발

### 소스에서 빌드
```bash
# 저장소 복제
git clone https://github.com/pghoya2956/Google-Drive-MCP-Server.git
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
