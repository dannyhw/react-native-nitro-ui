# Nitro resolves a Hybrid Object implementation by *class name* through JNI
# (Class.forName("com.margelo.nitro.benchprobe.HybridBenchProbe")), which R8
# cannot see as a reference. Without this the release build shrinks/renames the
# class and every probe call fails with ClassNotFoundException.
-keep class com.margelo.nitro.benchprobe.** { *; }
