import { isDenoInstalled } from './Utils';
import { spawn } from 'child_process';
import readline from 'readline';
import { type InnertubeSupportServiceStatus } from './Service';
import path from 'path';
import kill from 'tree-kill';

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

export function spawnInnertubeSupportService(
  callbacks: SpawnedInnertubeSupportServiceCallbacks
) {
  return new Promise<SpawnedInnertubeSupportService>((resolve, reject) => {
    const { onStdOut, onStdErr, onStop } = callbacks;
    let proc;
    let runtime: 'node' | 'deno';
    const denoStatus = isDenoInstalled();
    if (denoStatus.installed) {
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
          runScript
        ],
        {
          cwd
        }
      );
    } else {
      onStdOut(
        `Deno not installed or otherwise failed to start: ${denoStatus.error.message}`
      );
      onStdOut('Start service with Node');
      runtime = 'node';
      proc = spawn('node', [runScript], {
        cwd
      });
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
