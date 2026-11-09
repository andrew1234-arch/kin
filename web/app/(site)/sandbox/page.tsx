import { permanentRedirect } from "next/navigation";

/** The sandbox is part of The flow now. */
export default function SandboxPage() {
  permanentRedirect("/flow#scale");
}
