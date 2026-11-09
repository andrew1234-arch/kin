import { Profile } from "./Profile";

export const metadata = {
  title: "Your profile",
  description: "Your wallets on Kin: the entity and limit Kin gave each one, what's in the vault, and claims.",
};

export default function ProfilePage() {
  return <Profile />;
}
