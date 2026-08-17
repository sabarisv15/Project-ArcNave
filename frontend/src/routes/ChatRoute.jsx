import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ChatView } from '../components/ChatView';
import { useWorkspace } from '../store/WorkspaceProvider';

export function ChatRoute() {
  const { chatId } = useParams();
  const { chats, threads, seedThread, sendMessage } = useWorkspace();
  const chat = chats.find((c) => c.id === chatId);

  useEffect(() => {
    if (chat) seedThread(chat);
  }, [chat, seedThread]);

  const messages = threads[chatId] || [];

  return (
    <ChatView
      chatId={chatId}
      title={chat?.title ?? 'New conversation'}
      meta={chat?.kind === 'project' ? chat.project : ''}
      messages={messages}
      placeholder="Reply to ArcNave…"
      onSend={(text, attachments) => sendMessage({ scope: 'chat', convId: chatId, text, attachments })}
    />
  );
}
