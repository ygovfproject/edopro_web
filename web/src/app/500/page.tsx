import ErrorPage from "@/components/errors/ErrorPage";

export const metadata = { title: "Server error · EDOPro Web" };

export default function ServerError() {
  return (
    <ErrorPage
      code={500}
      title="Server unavailable"
      text="The game server can't be reached right now. Please try again in a few minutes."
    />
  );
}
