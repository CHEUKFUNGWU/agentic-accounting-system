"""Local, trusted-operator provisioning. Never pass passwords on the command line."""
import argparse
import asyncio
import getpass
import json
import time

from sqlalchemy import select, update
from app.core.auth import (PrincipalModel, PrincipalSecretModel, ApiCredentialModel, AuthSessionModel,
    AuthEventModel, provision_principal, issue_key, seed_principals, hasher)
from app.core.db import db_manager
from app.core.positions import POSITIONS


async def run(args):
    await db_manager.init_db()
    await seed_principals()
    if args.action == "create-user":
        password = getpass.getpass("Password (12–256 characters): ")
        if password != getpass.getpass("Confirm password: "):
            raise ValueError("Passwords do not match.")
        await provision_principal(args.key, args.name or args.key, args.position, password=password)
        print("Human account created. Sign in using its principal key.")
    elif args.action == "create-agent":
        await provision_principal(args.key, args.name or args.key, args.position)
        print("Agent account created. Issue a separate API key to connect it.")
    elif args.action == "issue-key":
        print(json.dumps(await issue_key(args.key, args.days)))
        print("Store this key securely. It will not be displayed again.")
    else:
        async with db_manager.session_factory() as db:
            now = int(time.time())
            if args.action == "revoke-key":
                row = await db.get(ApiCredentialModel, args.key)
                if not row:
                    raise ValueError("Unknown credential ID.")
                row.revoked_at = now
                db.add(AuthEventModel(event="TOKEN_REVOKED", principal_key="local-operator", credential_id=args.key, detail=args.reason))
            else:
                row = await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == args.key))
                if not row:
                    raise ValueError("Unknown principal key.")
                if args.action == "suspend":
                    row.status = "SUSPENDED"
                    event = "PRINCIPAL_SUSPENDED"
                elif args.action == "reset-password":
                    if not row.is_human:
                        raise ValueError("Only human accounts have passwords.")
                    password = getpass.getpass("New password (12–256 characters): ")
                    if not 12 <= len(password) <= 256 or password != getpass.getpass("Confirm password: "):
                        raise ValueError("Passwords must match and contain 12–256 characters.")
                    secret = await db.get(PrincipalSecretModel, row.principal_id)
                    if not secret:
                        raise ValueError("Account has no password; use create-user for initial enrollment.")
                    secret.password_hash = await asyncio.to_thread(hasher.hash, password)
                    event = "PASSWORD_RESET"
                else:
                    event = "SESSIONS_TERMINATED"
                await db.execute(update(AuthSessionModel).where(AuthSessionModel.principal_id == row.principal_id).values(revoked_at=now))
                db.add(AuthEventModel(event=event, principal_key=args.key, detail=args.reason))
            await db.commit()
            print("Done. The change takes effect on the next request.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("create-user", "create-agent"):
        cmd = sub.add_parser(action)
        cmd.add_argument("key")
        cmd.add_argument("--name")
        cmd.add_argument("--position", required=True, choices=list(POSITIONS))
    cmd = sub.add_parser("issue-key")
    cmd.add_argument("key")
    cmd.add_argument("--days", type=int, default=90)
    for action in ("revoke-key", "suspend", "reset-password", "terminate-sessions"):
        cmd = sub.add_parser(action)
        cmd.add_argument("key")
        cmd.add_argument("--reason", required=True)
    try:
        asyncio.run(run(parser.parse_args()))
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
