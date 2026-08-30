# Improvement: Docker and Docker Compose

## The problem

By step 8 you have installed PostgreSQL natively. Some things will have gone wrong,
and they will have gone wrong differently for different people in the room:

- One person installed Postgres 16, another has 14 left over from a previous unit.
- Someone's install put `psql` outside their PATH.
- Someone else already had Postgres running on port 5432 for another project.
- The person on macOS followed different instructions from the person on Windows.
- Everyone typed their own password, so no two `DATABASE_URL` strings match.

None of this is about your code. All of it costs time, and all of it comes back the
day you deploy to a server that is configured differently again.

## Why the current setup hurts

The project has an undocumented dependency on the state of your machine. `npm install`
reproduces your Node packages exactly, on any machine, because `package.json` describes
them. Nothing describes your database. "Install Postgres and make a database called
`iot`" is a set of instructions for a human, and humans execute instructions
inconsistently.

The gap between "my code" and "my code plus everything it needs to run" is where
deployment problems live.

## What Docker is

A container is a packaged, isolated environment holding an application and everything
it depends on. A container running `postgres:16` is the same Postgres 16 on your
Windows laptop, your classmate's Mac, and the VPS, because it is the same image.

It is not a virtual machine. There is no guest operating system, so it starts in
seconds rather than minutes.

Two terms:

- **Image**: the read-only template, for example `postgres:16`
- **Container**: a running instance of an image

## What changes

One file at the project root:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: iot
      POSTGRES_PASSWORD: iot
      POSTGRES_DB: iot
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Then, for everyone, on every operating system:

```bash
docker compose up -d
```

Your `DATABASE_URL` becomes identical for the whole class:

```
postgresql://iot:iot@localhost:5432/iot
```

The `volumes` entry matters. Container filesystems are disposable, so without a named
volume your data disappears when the container is removed. With it, the data lives
outside the container and survives.

## Why this matters beyond convenience

**Reproducibility.** The setup is now described in a file that is committed and
reviewed, not in a paragraph of prose someone may not follow. New team member, new
laptop, reinstalled OS: one command.

**Version pinning.** `postgres:16` is explicit. Nobody accidentally develops against
16 and deploys against 13.

**Isolation.** Two projects can want two different Postgres versions and neither
notices the other. Natively, they fight over port 5432 and one loses.

**It is what deployment actually looks like.** Almost every hosting platform expects
a container. Learning Docker at this point is not extra work, it is the work you
would do later anyway, done at the moment it makes sense.

**Multi-service growth.** When you add a local Mosquitto broker, Redis, or a
time-series database, each is a few more lines in the same file rather than another
native install with its own quirks.

## What it costs

Be clear-eyed about this, because it is the reason Docker is not in the core build.

- Docker Desktop is a large install and needs virtualisation support enabled in BIOS,
  which some school and work machines do not permit.
- It is a genuinely new mental model: images, containers, volumes, networks, port
  mapping. That is a lesson of its own, and mixing it into "learn MQTT and
  TypeScript" means learning neither well.
- The failure modes are new too. A container that exits immediately, a port already
  allocated, a volume holding stale data from a schema you have since changed.
- On low-RAM laptops it is noticeably heavy.

## When to make the switch

When any of these is true:

- You are deploying to a VPS.
- More than one person works on the project.
- The project needs more than one service.
- You have lost more than an hour to a database setup difference.

Until then, a native Postgres install is a perfectly reasonable choice. Docker is not
better in the abstract, it is better once the problems above are yours.

## Reading

Docker's own "Get Started" guide and the Compose file reference. I have not linked
specific URLs here because Docker reorganises its documentation site regularly, so
search from docs.docker.com rather than trusting a link pasted into course notes.
