import ErrorPage from "@/components/errors/ErrorPage";

export const metadata = { title: "Page not found · EDOPro Web" };

export default function NotFound() {
  return <ErrorPage code={404} title="Page not found" text="There's nothing at this address." />;
}
