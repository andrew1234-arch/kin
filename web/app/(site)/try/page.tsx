import { permanentRedirect } from "next/navigation";

/** Try it is part of The flow now. */
export default function TryPage() {
  permanentRedirect("/flow#yourself");
}
