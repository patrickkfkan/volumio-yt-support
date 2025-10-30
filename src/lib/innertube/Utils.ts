import { execSync } from 'child_process';
import type Innertube from 'volumio-youtubei.js';
import { type Logger } from '../utils/Logger';

export type DenoInstallStatus =
  | {
      installed: true;
      version: string;
    }
  | {
      installed: false;
      error: Error;
    };

let denoInstalled: DenoInstallStatus | undefined = undefined;

export function isDenoInstalled(): DenoInstallStatus {
  if (denoInstalled !== undefined) {
    return denoInstalled;
  }
  try {
    const output = execSync('npx --no-install --yes deno --version', {
      cwd: __dirname,
      encoding: 'utf-8'
    });
    denoInstalled = {
      installed: true,
      version: output.trim().split(/\r?\n/)[0]
    };
  } catch (error) {
    denoInstalled = {
      installed: false,
      error: error instanceof Error ? error : Error(String(error))
    };
  }
  return denoInstalled;
}

export async function getActiveAccountDatasyncIdToken(
  innertube: Innertube,
  logger: Logger,
  activeChannelHandle?: string
) {
  if (!innertube.session.logged_in) {
    return {
      hasActiveAccount: false as const
    };
  }
  const accounts = (await innertube.account.getInfo(true)).filter(
    (ac) => !ac.is_disabled
  );
  const active = accounts.find((ac) => ac.is_selected);
  let target;
  if (activeChannelHandle) {
    target = accounts.find(
      (ac) => ac.channel_handle.toString() === activeChannelHandle
    );
    if (!target) {
      logger.warn(
        `No accounts found with channel handle "${activeChannelHandle}"`
      );
      target = active;
    }
  } else {
    target = active;
  }
  if (!target) {
    return {
      hasActiveAccount: false as const
    };
  }
  let pageId: string | undefined = undefined;
  let datasyncIdToken: string | undefined = undefined;
  if (Array.isArray(target.endpoint.payload.supportedTokens)) {
    for (const token of target.endpoint.payload.supportedTokens) {
      if (
        Reflect.has(token, 'pageIdToken') &&
        Reflect.has(token.pageIdToken, 'pageId')
      ) {
        pageId = String(token.pageIdToken.pageId);
      } else if (
        Reflect.has(token, 'datasyncIdToken') &&
        Reflect.has(token.datasyncIdToken, 'datasyncIdToken')
      ) {
        datasyncIdToken = String(token.datasyncIdToken.datasyncIdToken);
      }
    }
  }
  return {
    hasActiveAccount: true as const,
    datasyncIdToken,
    pageId
  };
}
