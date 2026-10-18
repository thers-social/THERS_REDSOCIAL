import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@features/messages/ChatScreen';

/** Chat grupal (`ADR-048`). */
export default function GroupChat() {
  const { groupId, name } = useLocalSearchParams<{ groupId: string; name?: string }>();
  return <ChatScreen kind="group" id={groupId} name={name} />;
}
