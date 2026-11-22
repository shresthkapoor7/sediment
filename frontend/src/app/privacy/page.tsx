import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy | Sediment" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="November 22, 2026">
      <h2>What Sediment stores</h2>
      <ul>
        <li><strong>Without an account:</strong> a random ID kept in your browser, and the canvases, notes, chats and uploaded files you create under it.</li>
        <li><strong>With a Google account:</strong> your name, email address and profile picture from Google, plus the same canvases, notes, chats and files, tied to your account.</li>
        <li><strong>Usage:</strong> how many requests you make and what they cost, to enforce daily limits. Your IP address is only kept as a one-way hash, used to stop abuse.</li>
      </ul>
      <h2>How it is used</h2>
      <p>Only to run Sediment: saving your work, answering your questions with the research agent, and keeping usage within limits. We do not sell your data or use it for advertising.</p>
      <h2>Who else sees it</h2>
      <ul>
        <li><strong>Supabase</strong> hosts the database, sign-in and file storage.</li>
        <li><strong>Anthropic</strong> runs the research agent; your questions and the canvas context they need are sent to it.</li>
        <li><strong>OpenAlex</strong> and other paper sources receive your search queries.</li>
      </ul>
      <p>A canvas is only visible to others if you create a share link for it.</p>
      <h2>Your choices</h2>
      <p>You can delete canvases at any time, and sign out from the account page. To delete your account and everything in it, email <a href="mailto:shresthkapoor7@gmail.com">shresthkapoor7@gmail.com</a>.</p>
    </LegalPage>
  );
}
