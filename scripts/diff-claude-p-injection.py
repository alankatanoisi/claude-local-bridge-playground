#!/usr/bin/env python3
"""Diff two redacted claude -p injection captures (lab-notes artifacts)."""

import argparse
import difflib
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file_a', type=Path, help='First capture (e.g. run A)')
    parser.add_argument('file_b', type=Path, help='Second capture (e.g. run B)')
    parser.add_argument(
        '--context',
        type=int,
        default=3,
        help='Unified diff context lines (default: 3)',
    )
    args = parser.parse_args()

    if not args.file_a.is_file():
        print(f'Error: not found: {args.file_a}', file=sys.stderr)
        return 1
    if not args.file_b.is_file():
        print(f'Error: not found: {args.file_b}', file=sys.stderr)
        return 1

    a = args.file_a.read_text(encoding='utf-8', errors='replace').splitlines(keepends=True)
    b = args.file_b.read_text(encoding='utf-8', errors='replace').splitlines(keepends=True)

    diff = difflib.unified_diff(
        a,
        b,
        fromfile=str(args.file_a),
        tofile=str(args.file_b),
        n=args.context,
    )
    out = ''.join(diff)
    if not out:
        print('No differences.')
        return 0
    sys.stdout.write(out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
