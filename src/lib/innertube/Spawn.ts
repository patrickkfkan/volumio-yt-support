import { isDenoInstalled } from './Utils';
import { spawn } from 'child_process';
import readline from 'readline';
import { type InnertubeSupportServiceStatus } from './Service';
import path from 'path';
import kill from 'tree-kill';
import { type IGetChallengeResponse } from 'volumio-youtubei.js';

export type SpawnedInnertubeSupportService = InnertubeSupportServiceStatus & {
  stop: () => Promise<void>;
  runtime: 'node' | 'deno';
};

export interface SpawnedInnertubeSupportServiceCallbacks {
  onStdOut: (data: any) => void;
  onStdErr: (data: any) => void;
  onStop: () => void;
}

const runScript = path.resolve(__dirname, '../../scripts/run.js');
const cwd = path.resolve(__dirname, '../../../');
const env = {
  PATH: process.env.PATH
};

export function spawnInnertubeSupportService(params: {
  jsRuntime?: 'node' | 'deno';
  challengeResponse: IGetChallengeResponse;
  callbacks: SpawnedInnertubeSupportServiceCallbacks;
}) {
  const { challengeResponse, callbacks } = params;
  let runtime = params.jsRuntime;
  return new Promise<SpawnedInnertubeSupportService>((resolve, reject) => {
    const { onStdOut, onStdErr, onStop } = callbacks;
    let proc;
    const denoStatus = isDenoInstalled();
    if (
      (runtime === undefined || runtime === 'deno') &&
      !denoStatus.installed
    ) {
      onStdOut(
        `Deno not installed or otherwise failed to start: ${denoStatus.error.message}`
      );
      if (runtime === 'deno') {
        throw Error('JS runtime "Deno" not found');
      }
    }
    if (runtime === undefined) {
      runtime = denoStatus.installed ? 'deno' : 'node';
    }
    if (runtime === 'deno' && denoStatus.installed) {
      onStdOut(`Start service with Deno: ${denoStatus.version}`);
      runtime = 'deno';
      proc = spawn(
        'npx',
        [
          'deno',
          'run',
          '--quiet',
          '--no-prompt',
          '--allow-read=.',
          '--allow-net',
          '--allow-env',
          runScript,
          '--challenge_response',
          JSON.stringify(challengeResponse)
        ],
        {
          cwd,
          env
        }
      );
    } else {
      onStdOut('Start service with Node');
      runtime = 'node';
      proc = spawn(
        'node',
        [runScript, '--challenge_response', JSON.stringify(challengeResponse)],
        {
          cwd,
          env
        }
      );
    }

    proc.stdout.on('data', (data) => {
      onStdOut(data);
    });

    proc.stderr.on('data', (data) => {
      onStdErr(data);
    });

    proc.on('close', (code) => {
      onStdOut(`Process closed with code ${code}`);
      onStop();
    });

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity
    });
    rl.on('line', (line) => {
      if (line.startsWith('result: ')) {
        const resultJSON = line.substring('result: '.length);
        try {
          return resolve({
            ...JSON.parse(resultJSON),
            runtime,
            stop: () =>
              new Promise((resolve) => {
                onStdOut('Stopping service...');
                if (proc.pid) {
                  proc.once('close', () => resolve());
                  kill(proc.pid);
                } else {
                  onStdErr('Could not stop service because process lacks pid');
                  resolve();
                }
              })
          });
        } catch (err) {
          proc.kill();
          return reject(
            Error(
              `Failed to parse service result: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        } finally {
          rl.close();
        }
      }
    });
  });
}
