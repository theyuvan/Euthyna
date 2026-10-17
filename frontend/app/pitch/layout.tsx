import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pitch · Euthyna",
  description: "Euthyna in six slides: an AI treasurer whose spending limit is earned on-chain.",
};

export default function PitchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
