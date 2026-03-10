import { InnertubeSupportService } from '../lib/innertube/Service';

const service = new InnertubeSupportService();

process.on('SIGTERM', () => {
  console.log('Received SIGTERM');
  void (async () => {
    try {
      await service.stop();
    } finally {
      process.exit(0);
    }
  })();
});

try {
  const args: string[] =
    typeof (globalThis as any).Deno !== 'undefined' ?
      (globalThis as any).Deno.args
    : (globalThis as any).process.argv.slice(2);
  const challengeResponse =
    args[args.indexOf('--challenge_response') + 1] || '{}';
  void (async () => {
    const status = await service.start({ challengeResponse });
    console.log(`result: ${JSON.stringify(status)}`);
  })();
} catch (error) {
  console.log(
    `result: ${JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    })}`
  );
}
