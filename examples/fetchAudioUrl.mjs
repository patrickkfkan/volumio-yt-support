import { InnertubeFactory } from '../dist/index.js';

const videoId = 'Z6fXl2qP9HY';

const wrapper = await InnertubeFactory.getWrappedInstance({
  account: {
    // cookie: '...'
  },
  logger: {
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg)
  }
});

const innertube = await wrapper.getInnertube();
const contentPot = (await wrapper.generatePoToken(videoId)).poToken;
const info = await innertube.getBasicInfo(videoId, {
  client: 'YTMUSIC',
  po_token: contentPot
});

const audioUrl = await info
  .chooseFormat({
    quality: 'best',
    type: 'audio'
  })
  .decipher(innertube.session.player);

// Innertube sets `pot` searchParam of URL to session-bound PO token.
// Seems YouTube now requires `pot` to be the *content-bound* token, otherwise we'll get 403.
// See: https://github.com/TeamNewPipe/NewPipeExtractor/issues/1392
const fixedUrl = new URL(audioUrl);
fixedUrl.searchParams.set('pot', contentPot);

console.log(`Audio URL for video "${videoId}":`, fixedUrl.toString());

await wrapper.dispose();
process.exit(0);
