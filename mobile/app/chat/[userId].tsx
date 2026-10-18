import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@features/messages/ChatScreen';

/** Chat directo con una persona (`ADR-035`). La pantalla es la misma que la de un grupo (`ADR-048`). */
export default function Chat() {
  const { userId, name, username, avatar } = useLocalSearchParams<{
    userId: string;
    name?: string;
    username?: string;
    avatar?: string;
  }>();
  return <ChatScreen kind="user" id={userId} name={name} username={username} avatar={avatar} />;
}
