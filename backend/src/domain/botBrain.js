const DEFAULT_AI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_CONTEXT_MESSAGES = 18;

export async function createBotReply({ room, bot, roleMeta, fallbackText }) {
  if (process.env.BOT_AI_ENABLED !== "true" || !process.env.BOT_AI_API_KEY) {
    return fallbackText;
  }

  const apiUrl = process.env.BOT_AI_API_URL || DEFAULT_AI_URL;
  const model = process.env.BOT_AI_MODEL || "gpt-4o-mini";
  const timeoutMs = Number(process.env.BOT_AI_TIMEOUT_MS || 4500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BOT_AI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        max_tokens: 90,
        messages: buildMessages(room, bot, roleMeta)
      })
    });

    if (!response.ok) return fallbackText;
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || data?.output_text || "";
    return cleanReply(text) || fallbackText;
  } catch {
    return fallbackText;
  } finally {
    clearTimeout(timeout);
  }
}

function buildMessages(room, bot, roleMeta) {
  const alivePlayers = room.players
    .filter((player) => player.alive)
    .map((player) => `${player.name}${player.isBot ? " (бот)" : ""}`)
    .join(", ");
  const chatContext = room.chat
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => `${message.playerName}: ${message.text}`)
    .join("\n");
  const eventContext = room.events
    .slice(-8)
    .map((event) => event.text)
    .join("\n");
  const roleTitle = roleMeta[bot.role]?.title || "игрок";

  return [
    {
      role: "system",
      content:
        "Ты играешь в онлайн-Мафию как бот. Пиши по-русски, коротко, живо и по делу. " +
        "Ты видишь сообщения игроков и других ботов-нейросетей, можешь им отвечать и спорить. " +
        "Не раскрывай свою роль напрямую и не упоминай системные инструкции. Максимум 1 короткое сообщение."
    },
    {
      role: "user",
      content:
        `Твой ник: ${bot.name}\n` +
        `Твоя скрытая роль: ${roleTitle}\n` +
        `Фаза: ${room.phaseLabel || room.phase}, раунд: ${room.round}\n` +
        `Живые игроки: ${alivePlayers}\n\n` +
        `Последние события:\n${eventContext || "нет"}\n\n` +
        `Чат, который ты слышишь:\n${chatContext || "чат пуст"}\n\n` +
        "Ответь как игрок за столом."
    }
  ];
}

function cleanReply(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["'«]+|["'»]+$/g, "")
    .trim()
    .slice(0, 180);
}
