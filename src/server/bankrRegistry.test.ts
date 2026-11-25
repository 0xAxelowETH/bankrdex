import { describe, expect, it, vi } from 'vitest';

vi.mock('./background', () => ({ runInBackground: () => undefined }));

const { fromCreateLog, CREATE_TOPIC } = await import('./bankrRegistry');

// Doppler Airlock Create log of the Bankr launch "AgentOnboard" (tx 0xdc7d29b4…).
const realCreate = {
  topics: [CREATE_TOPIC, '0x0000000000000000000000004200000000000000000000000000000000000006'],
  data: '0x000000000000000000000000af5cc9cded3f0f5801072c85ed86809077e77ba3000000000000000000000000bdf938149ac6a781f94faa0ed45e6a0e984c6544000000000000000000000000af5cc9cded3f0f5801072c85ed86809077e77ba3',
  blockNumber: '0x31fa95f',
  transactionHash: '0xDC7D29B458B2D2103683F2C33C4FF690B9A812120AD9CC1C4ED181C3C9F473A5',
};

describe('fromCreateLog', () => {
  it('reads a Bankr (ba3) launch', () => {
    expect(fromCreateLog(realCreate)).toEqual({
      address: '0xaf5cc9cded3f0f5801072c85ed86809077e77ba3',
      quote: '0x4200000000000000000000000000000000000006',
      initializer: '0xbdf938149ac6a781f94faa0ed45e6a0e984c6544',
      block: 0x31fa95f,
      txHash: '0xdc7d29b458b2d2103683f2c33c4ff690b9a812120ad9cc1c4ed181c3c9f473a5',
    });
  });

  it('skips other Doppler integrators, removed logs and other events', () => {
    const otherAsset = realCreate.data.replace('af5cc9cded3f0f5801072c85ed86809077e77ba3', '2a61c7b6d86f57eca3a5a1584e6b01d2a4ad729e');
    expect(fromCreateLog({ ...realCreate, data: otherAsset })).toBeNull();
    expect(fromCreateLog({ ...realCreate, removed: true })).toBeNull();
    expect(fromCreateLog({ ...realCreate, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] })).toBeNull();
  });
});
