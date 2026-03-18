import { BG, buildURL, GOOG_API_KEY, type WebPoSignalOutput } from 'bgutils-js';
import { type WebPoMinter } from 'bgutils-js/dist/core';
import { JSDOM } from 'jsdom';
import { USER_AGENT } from './Constants';
import { type IGetChallengeResponse } from 'volumio-youtubei.js';
import { loadEsm } from 'load-esm';

export interface PoTokenData {
  poToken: string;
  ttl: number;
  refreshThreshold: number;
}

export interface PoTokenMinterResult {
  minter: WebPoMinter;
  ttl: number;
  refreshThreshold: number;
  created: number;
}

export async function createPoTokenMinter(params: {
  challengeResponse: string;
}): Promise<PoTokenMinterResult> {
  const userAgent = USER_AGENT;

  let challengeResponse: IGetChallengeResponse;
  try {
    challengeResponse = JSON.parse(params.challengeResponse);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error : Error(String(error));
    throw Error(
      `Error parsing challenge response "${params.challengeResponse}": ${errMsg}`
    );
  }

  /**
   * Largely taken from:
   * https://github.com/LuanRT/BgUtils/blob/54c511b2bd4e3e3707f30d2907f33167e1b61b35/examples/node/innertube-challenge-fetcher-example.ts
   */

  // #region BotGuard Initialization
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
    {
      url: 'https://www.youtube.com/',
      referrer: 'https://www.youtube.com/',
      userAgent,
      pretendToBeVisual: true
    }
  );
  // Create a Happy DOM window just to access its canvas mock
  const { Window } = await loadEsm('happy-dom');
  const happyWindow = new Window();
  const happyCanvasProto = Object.getPrototypeOf(
    happyWindow.document.createElement('canvas')
  );
  // Patch JSDOM’s canvas with Happy DOM’s mock
  dom.window.HTMLCanvasElement.prototype.getContext =
    happyCanvasProto.getContext;

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin
  });

  if (!Reflect.has(globalThis, 'navigator')) {
    Object.defineProperty(globalThis, 'navigator', {
      value: dom.window.navigator
    });
  }

  if (!challengeResponse.bg_challenge) {
    throw Error('Could not get challenge');
  }

  const interpreterUrl =
    challengeResponse.bg_challenge.interpreter_url
      .private_do_not_access_or_else_trusted_resource_url_wrapped_value;
  const bgScriptResponse = await fetch(`https:${interpreterUrl}`);
  const interpreterJavascript = await bgScriptResponse.text();

  if (interpreterJavascript) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(interpreterJavascript)();
  } else throw new Error('Could not load VM');

  const botguard = await BG.BotGuardClient.create({
    program: challengeResponse.bg_challenge.program,
    globalName: challengeResponse.bg_challenge.global_name,
    globalObj: globalThis
  });
  // #endregion

  // #region WebPO Token Generation
  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const requestKey = 'O43z0dpjhgX20SCx4KAo';

  const integrityTokenResponse = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
      'user-agent': userAgent
    },
    body: JSON.stringify([requestKey, botguardResponse])
  });

  const response = (await integrityTokenResponse.json()) as [
    string,
    number,
    number,
    string
  ];

  if (typeof response[0] !== 'string')
    throw new Error('Could not get integrity token');

  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold] = response;

  if (typeof response[0] !== 'string')
    throw new Error('Could not get integrity token');

  const integrityTokenBasedMinter = await BG.WebPoMinter.create(
    { integrityToken },
    webPoSignalOutput
  );
  // #endregion

  return {
    minter: integrityTokenBasedMinter,
    ttl: estimatedTtlSecs,
    refreshThreshold: mintRefreshThreshold,
    created: Date.now()
  };
}
