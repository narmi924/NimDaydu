const PLATFORMS: [string, string][] = [
  ['discord.com', 'Discord'], ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'],
  ['slack.com', 'Slack'], ['meet.google.com', 'Google Meet'], ['teams.microsoft.com', 'Teams'],
  ['teams.live.com', 'Teams'], ['zoom.us', 'Zoom'], ['twitch.tv', 'Twitch'],
  ['bilibili.com', '哔哩哔哩'], ['vimeo.com', 'Vimeo'],
];
export function identifySource(url?: string): { site: string; host: string } {
  try {
    const host = new URL(url || '').hostname.toLowerCase().replace(/^www\./, '');
    const match = PLATFORMS.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
    return { site: match?.[1] || (host === '127.0.0.1' || host === 'localhost' ? '测试网页' : '网页'), host };
  } catch { return { site: '网页', host: '' }; }
}
