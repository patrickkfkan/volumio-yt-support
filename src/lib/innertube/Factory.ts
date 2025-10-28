import { InnertubeWrapper } from './Wrapper';

export class InnertubeFactory {
  static getWrappedInstance(
    ...args: Parameters<typeof InnertubeWrapper.create>
  ): Promise<InnertubeWrapper> {
    return InnertubeWrapper.create(...args);
  }
}
