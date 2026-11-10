"""Reads any image Pillow understands and writes a plain JPEG or PNG.

Applies the EXIF rotation so phone photos land the right way up, and
flattens transparency onto white for JPEG output.
"""
import sys

from PIL import Image, ImageOps


def main() -> None:
    src, dst, fmt = sys.argv[1], sys.argv[2], sys.argv[3].lower()
    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    if fmt == "png":
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        img.save(dst, "PNG")
        return
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        img = canvas
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.save(dst, "JPEG", quality=92)


if __name__ == "__main__":
    main()
