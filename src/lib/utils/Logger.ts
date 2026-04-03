export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export class DefaultLogger implements Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export function getErrorMessage(message: string, error: any, stack = true): string {
  let result = message;
  if (typeof error == 'object') {
    if (error.message) {
      result += ` ${error.message}`;
    }
    if (error.info) { // InnertubeError has this
      result += `: ${error.info}`;
    }
    if (stack && error.stack) {
      result += ` ${error.stack}`;
    }
  }
  else if (typeof error == 'string') {
    result += ` ${error}`;
  }
  return result.trim();
}
