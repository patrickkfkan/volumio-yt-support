# volumio-yt-support

Supporting module for YouTube plugins on Volumio.

The main purpose is to encapsulate the task of creating an `Innertube` instance using a [customized version](https://github.com/patrickkfkan/Volumio-YouTube.js) of the [YouTube.js]((https://github.com/LuanRT/YouTube.js/)) library and managing its lifecyle.

## Usage

### Create a wrapped Innertube instance

```
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
```

Here's what happens:

1. The wrapper creates an `Innertube` instance.
2. It starts a support service in an external process that handles:
   - Minting PO tokens;
   - Evaluating code passed to Innertube's `Platform.shim.eval` method.
3. It generates a PO token bound to the session of the created `Innertube` instance.

PO tokens have an expiry time. The wrapper will automatically refresh the session-bound token created in step (3).

### Wrapper methods

#### `wrapper.getInnertube()`

Returns the wrapped `Innertube` instance.

#### `wrapper.getSessionPoToken()`

Returns the current PO token bound to the session of the wrapped `Innertube` instance. You would typically use this token in player requests such as `innertube.getBasicInfo()`:

```
innertube.getBasicInfo(videoId, { po_token: (await wrapper.getSessionPoToken()).poToken });
```

#### `wrapper.generatePoToken(identifier)`

Generates a PO token for `identifier`. You would typically use this for obtaining content-bound PO token required for some `Innertube` client types when fetching streaming data, where `identifier` would be the ID of the video.

#### `wrapper.dispose()`

Disposes the `Innertube` instance and shuts down the support service. Once disposed, calling any wrapper method will throw an error.

## Security

To obtain PO tokens and decipher stream URLs, Innertube needs to execute code obtained from YouTube / Google servers. The code evaluation is performed by the support service described earlier. Where possible, [Deno](https://deno.com/) is used to start this service since it provides some level of sandboxing. The risk is greatest when `Deno` is unavailable, since `node` would then be used (basically no sandboxing).

## Changelog

2.2.0
- Add external player (VLC / mpv) support.

2.1.2
- Fix channel handle not applied in session context.
- Remove duplicate express middleware.

2.1.1
- Fix import error

2.1.0
- Update [Volumio-YouTube.js](https://github.com/patrickkfkan/Volumio-YouTube.js) v1.7.0 (based on [YouTube.js](https://github.com/LuanRT/YouTube.js) v17.0.1) which, among other things, fixes n/sig decipher function extraction.

2.0.0
- Fix minter giving invalid PO tokens
- Add `jsRuntime` option - mainly for testing purposes

***Breaking change***

`Innertube` instances no longer come pre-bound with a session PO Token. You must now manually fetch the token using `Wrapper#getSessionPoToken()` and provide it during request execution.

1.1.0
- Add `AutoplayManager` (migrated from YouTube2 / YouTube Music plugins)
- Some cleanup and refactoring

1.0.0
- Initial release