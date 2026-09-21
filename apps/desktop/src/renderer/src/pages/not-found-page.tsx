import { Link } from "react-router-dom";

import { Page } from "@/components/layout/page";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <Page title="There is no page at this address" lede="The link may be old, or the page moved.">
      <Button asChild>
        <Link to="/">Back to the workspace</Link>
      </Button>
    </Page>
  );
}
