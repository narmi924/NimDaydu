import { expect, it } from 'vitest';
import { identifySource } from './source';
it('identifies common sources and keeps generic Chrome audio pages usable', () => {
  expect(identifySource('https://discord.com/channels/1/2').site).toBe('Discord');
  expect(identifySource('https://www.youtube.com/watch?v=example').site).toBe('YouTube');
  expect(identifySource('https://team.slack.com/').site).toBe('Slack');
  expect(identifySource('https://meet.google.com/abc').site).toBe('Google Meet');
  expect(identifySource('https://youtube.com.evil.example').site).toBe('网页');
  expect(identifySource('https://example.com/video').site).toBe('网页');
});
