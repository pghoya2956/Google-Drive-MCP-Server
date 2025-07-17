import { InternalToolResponse } from "./types.js";

export enum ErrorType {
  AUTH_ERROR = "AUTH_ERROR",
  PERMISSION_ERROR = "PERMISSION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  RATE_LIMIT = "RATE_LIMIT",
  NETWORK_ERROR = "NETWORK_ERROR",
  INVALID_INPUT = "INVALID_INPUT",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  PDF_PARSE_ERROR = "PDF_PARSE_ERROR",
  PDF_SIZE_LIMIT = "PDF_SIZE_LIMIT",
  PDF_ENCRYPTED = "PDF_ENCRYPTED",
  PDF_SCANNED = "PDF_SCANNED",
  UNKNOWN = "UNKNOWN"
}

export interface ErrorDetails {
  type: ErrorType;
  message: string;
  retryable: boolean;
  statusCode?: number;
  originalError?: any;
}

export function classifyError(error: any): ErrorDetails {
  const message = error.message || String(error);
  const statusCode = error.response?.status || error.code;

  // Auth errors
  if (statusCode === 401 || message.includes("authentication") || message.includes("unauthorized")) {
    return {
      type: ErrorType.AUTH_ERROR,
      message: "Authentication failed. Please check your credentials.",
      retryable: false,
      statusCode
    };
  }

  // Permission errors
  if (statusCode === 403 || message.includes("permission") || message.includes("forbidden")) {
    return {
      type: ErrorType.PERMISSION_ERROR,
      message: "You don't have permission to access this resource.",
      retryable: false,
      statusCode
    };
  }

  // Not found errors
  if (statusCode === 404 || message.includes("not found") || message.includes("File not found")) {
    return {
      type: ErrorType.NOT_FOUND,
      message: "The requested resource was not found.",
      retryable: false,
      statusCode
    };
  }

  // Rate limit errors
  if (statusCode === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return {
      type: ErrorType.RATE_LIMIT,
      message: "Rate limit exceeded. Please try again later.",
      retryable: true,
      statusCode
    };
  }

  // Network errors
  if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT") || message.includes("network")) {
    return {
      type: ErrorType.NETWORK_ERROR,
      message: "Network error. Please check your connection.",
      retryable: true,
      statusCode
    };
  }

  // Quota errors
  if (message.includes("quota") || message.includes("storage limit")) {
    return {
      type: ErrorType.QUOTA_EXCEEDED,
      message: "Storage quota exceeded.",
      retryable: false,
      statusCode
    };
  }

  // PDF-specific errors
  if (message.includes("PDF 파일이 20MB를 초과")) {
    return {
      type: ErrorType.PDF_SIZE_LIMIT,
      message: message,
      retryable: false,
      statusCode
    };
  }

  if (message.includes("암호로 보호되어")) {
    return {
      type: ErrorType.PDF_ENCRYPTED,
      message: message,
      retryable: false,
      statusCode
    };
  }

  if (message.includes("스캔된 이미지로 구성")) {
    return {
      type: ErrorType.PDF_SCANNED,
      message: message,
      retryable: false,
      statusCode
    };
  }

  if (message.includes("PDF 파싱 오류")) {
    return {
      type: ErrorType.PDF_PARSE_ERROR,
      message: message,
      retryable: false,
      statusCode
    };
  }

  // Default
  return {
    type: ErrorType.UNKNOWN,
    message: message,
    retryable: false,
    statusCode,
    originalError: error
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorDetails = classifyError(error);
      
      if (!errorDetails.retryable || attempt === maxRetries) {
        throw error;
      }
      
      console.error(`Attempt ${attempt} failed: ${errorDetails.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  
  throw lastError;
}

export function createErrorResponse(error: any, context?: string): InternalToolResponse {
  const errorDetails = classifyError(error);
  
  let errorMessage = errorDetails.message;
  if (context) {
    errorMessage = `${context}: ${errorMessage}`;
  }
  
  // Add helpful suggestions based on error type
  switch (errorDetails.type) {
    case ErrorType.AUTH_ERROR:
      errorMessage += "\n\nSuggestion: Re-authenticate using the auth flow.";
      break;
    case ErrorType.PERMISSION_ERROR:
      errorMessage += "\n\nSuggestion: Check if the file/folder is shared with your account.";
      break;
    case ErrorType.NOT_FOUND:
      errorMessage += "\n\nSuggestion: Verify the file/folder ID is correct.";
      break;
    case ErrorType.RATE_LIMIT:
      errorMessage += "\n\nSuggestion: Wait a few minutes before trying again.";
      break;
    case ErrorType.NETWORK_ERROR:
      errorMessage += "\n\nSuggestion: Check your internet connection and try again.";
      break;
    case ErrorType.QUOTA_EXCEEDED:
      errorMessage += "\n\nSuggestion: Free up space in your Google Drive.";
      break;
    case ErrorType.PDF_SIZE_LIMIT:
      errorMessage += "\n\n제안: PDF 파일을 압축하거나 분할하여 20MB 이하로 만들어주세요.";
      break;
    case ErrorType.PDF_ENCRYPTED:
      errorMessage += "\n\n제안: PDF 파일의 비밀번호를 제거한 후 다시 시도해주세요.";
      break;
    case ErrorType.PDF_SCANNED:
      errorMessage += "\n\n제안: OCR 기능을 사용해 텍스트를 추출한 PDF를 생성해주세요.";
      break;
    case ErrorType.PDF_PARSE_ERROR:
      errorMessage += "\n\n제안: PDF 파일이 손상되었을 수 있습니다. 다시 다운로드하거나 다른 PDF 뷰어로 확인해주세요.";
      break;
  }
  
  return {
    content: [
      {
        type: "text",
        text: errorMessage,
      },
    ],
    isError: true,
  };
}

// Helper function to safely parse Google Drive API errors
export function parseGoogleApiError(error: any): string {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  
  if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.map((e: any) => e.message).join(', ');
  }
  
  return error.message || 'Unknown error occurred';
}