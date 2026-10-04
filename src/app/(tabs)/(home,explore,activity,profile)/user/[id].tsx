import { useLocalSearchParams } from 'expo-router';

import { ProfileView } from '@/presentation/components/ProfileView';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView userId={id} />;
}
