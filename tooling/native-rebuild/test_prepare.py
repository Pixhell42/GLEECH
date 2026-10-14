"""Archive boundary tests for the native source preparation tool."""

import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "prepare_native", pathlib.Path(__file__).resolve().parents[1] / "prepare-native-rebuild.py"
)
prepare_native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_native)


class ArchiveBoundaryTests(unittest.TestCase):
    def setUp(self):
        test_root = pathlib.Path(__file__).resolve().parents[2] / "test-results/native-rebuild-tests"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, name, link=None):
        path = self.root / "source.tar"
        with tarfile.open(path, "w") as output:
            info = tarfile.TarInfo(name)
            if link is None:
                info.size = 5
                output.addfile(info, io.BytesIO(b"hello"))
            else:
                info.type = tarfile.SYMTYPE
                info.linkname = link
                output.addfile(info)
        return path

    def test_strips_single_source_root(self):
        prepare_native.extract(self.archive("source/src/file.txt"), self.root / "out")
        self.assertEqual((self.root / "out/src/file.txt").read_bytes(), b"hello")

    def test_rejects_parent_traversal(self):
        with self.assertRaises(ValueError):
            prepare_native.extract(self.archive("source/../../escaped"), self.root / "out")
        self.assertFalse((self.root / "escaped").exists())

    def test_rejects_absolute_path(self):
        with self.assertRaises(ValueError):
            prepare_native.extract(self.archive("/source/file.txt"), self.root / "out")

    def test_rejects_windows_path(self):
        with self.assertRaises(ValueError):
            prepare_native.extract(self.archive("C:/source/file.txt"), self.root / "out")

    def test_rejects_escaping_symlink(self):
        with self.assertRaises(tarfile.FilterError):
            prepare_native.extract(self.archive("source/link", "../../escaped"), self.root / "out")

    def test_does_not_overwrite_existing_output(self):
        output = self.root / "out"
        output.mkdir()
        (output / "keep.txt").write_text("keep", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            prepare_native.extract(self.archive("source/file.txt"), output)
        self.assertEqual((output / "keep.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
