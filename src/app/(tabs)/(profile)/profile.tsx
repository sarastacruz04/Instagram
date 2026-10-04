import { ProfileView } from '@/presentation/components/ProfileView';
import { useSession } from '@/presentation/stores/sessionStore';

export default function MyProfileScreen() {
  const userId = useSession((s) => s.userId);
  return userId ? <ProfileView userId={userId} /> : null;
}
