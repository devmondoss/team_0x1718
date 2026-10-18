import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const source = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-source",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Seguridad Financiera Adaptativa",
  description:
    "Demo de una cuenta en soles que sigue protegida cuando la persona no puede responder. Tres recorridos, decisión explicada y datos sintéticos.",
};

export default function ExperienciaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${fraunces.variable} ${source.variable}`}>{children}</div>;
}
