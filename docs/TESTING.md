# Testing

## The browser layer has its own database

`mix test` gets `nebulith_test` and the Ecto sandbox, so nothing it does survives the test.

The browser gates cannot have that. They drive a real server over real HTTP from another process,
so there is no sandbox to join, and several of them author maps and click Save. They used to point
at the dev server, which meant they ran against real working data.

**It did what you would expect.** A gate generated a woodland over an authored village, and four
maps with 3,260 placed tiles were left behind by runs that deleted their template but not the map
it had become.

CI never noticed, and that is the part worth remembering: on a runner the dev database is created
empty and thrown away, so the identical command was harmless there and destructive here. A
difference between how CI runs something and how a person runs it will hide a defect for exactly as
long as it exists.

So:

```bash
bin/e2e                        # every gate
bin/e2e login mapRoundTrip     # just those
```

It builds `nebulith_e2e`, seeds it, serves it on its own port, runs the gates and stops. CI runs the
same script. The address is not a default any more, it is required, and the dev port is refused:

```
Error: BASE is http://localhost:6328, which is the dev server and the dev database.
       These gates author maps and click Save. Run them through bin/e2e.
```
