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

1. The wrapper starts a support service in an external process that handles:
   - Minting PO tokens;
   - Evaluating code passed to Innertube's `Platform.shim.eval` method.
2. It then creates the actual `Innertube` instance with a session-bound PO token obtained from the support service.

PO tokens have an expiry time. Upon expiry of the token bound to the `Innertube` instance, the wrapper will automatically refresh the instance with a freshly-obtained token.

### Wrapper methods

#### `wrapper.getInnertube()`

Returns the wrapped `Innertube` instance.

#### `wrapper.generatePoToken(identifier)`

Generates a PO token for `identifier`. You would typically use this for obtaining content-bound PO token required for some `Innertube` client types when fetching streaming data, where `identifier` would be the ID of the video.

#### `wrapper.dispose()`

Disposes the `Innertube` instance and shuts down the support service. Once disposed, calling any wrapper method will throw an error.

## Security

To obtain PO tokens and decipher stream URLs, Innertube needs to execute code obtained from YouTube / Google servers. The code evaluation is performed by the support service described earlier. Where possible, [Deno](https://deno.com/) is used to start this service since it provides some level of sandboxing. The risk is greatest when `Deno` is unavailable, since `node` would then be used (basically no sandboxing).

## Changelog

1.0.0
- Initial release