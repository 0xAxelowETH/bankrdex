// Sends a message to the operator's Telegram chat. No-op (returns false) until
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are configured.
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendTelegram(html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) console.warn('Telegram send failed:', response.status, (await response.text()).slice(0, 200));
    return response.ok;
  } catch (error) {
    console.warn('Telegram send failed:', error instanceof Error ? error.message : error);
    return false;
  }
}
