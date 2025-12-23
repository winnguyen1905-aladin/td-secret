


# Install cmake (the missing dependency)
sudo apt install cmake build-essential

# Go into the cloned whisper.cpp directory 
cd whisper.cpp

# Build using cmake
cmake -B build
cmake --build build -j 4

# The executable will be at: build/bin/main