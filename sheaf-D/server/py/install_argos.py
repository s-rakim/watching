"""Installs Argos Translate language packs at image build time.

  install_argos.py es fr de

Installs English to and from each listed language. Other pairs are translated through
English, so this covers every combination of the listed languages too.
"""
import sys

from argostranslate import package


def main(codes):
    package.update_package_index()
    available = package.get_available_packages()
    for code in codes:
        for src, dst in (("en", code), (code, "en")):
            match = next((p for p in available if p.from_code == src and p.to_code == dst), None)
            if match is None:
                print(f"No Argos pack for {src} -> {dst}, skipping", file=sys.stderr)
                continue
            print(f"Installing {src} -> {dst}")
            package.install_from_path(match.download())


if __name__ == "__main__":
    main([c for c in sys.argv[1:] if c and c != "en"])
