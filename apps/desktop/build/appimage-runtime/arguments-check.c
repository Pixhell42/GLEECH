#define _GNU_SOURCE
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The build inserts the exact upstream/patched copy block here, with a bounds
 * assertion immediately after its array declaration and before any writes. */
static void check(int argc, char **argv) {
    const char *apprun_path = "/private extraction/AppRun";
    /* GLEECH_RUNTIME_ARGUMENT_COPY */
    assert(new_argv[new_argc] == NULL);
    assert(strcmp(new_argv[0], apprun_path) == 0);
    int expected = 1;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--appimage-extract-and-run") != 0) {
            assert(strcmp(new_argv[expected], argv[i]) == 0);
            ++expected;
        }
    }
    assert(new_argc == expected);
    for (int i = 0; i < new_argc; ++i) free(new_argv[i]);
}

int main(void) {
    char *args[64];
    const char *values[] = {"--cli", "", "path with spaces", "update", "--yes"};
    args[0] = "GLEECH.AppImage";
    for (int count = 1; count <= 64; ++count) {
        for (int i = 1; i < count; ++i) args[i] = (char *)values[i % 5];
        check(count, args); /* Environment-driven extraction retains every argument. */
        if (count > 1) {
            args[count / 2] = "--appimage-extract-and-run";
            check(count, args); /* Flag-driven extraction removes only that flag. */
        }
    }
    puts("Extraction argument capacity, terminator and forwarding passed.");
    return 0;
}
