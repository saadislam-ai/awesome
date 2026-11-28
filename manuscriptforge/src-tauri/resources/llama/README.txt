The local AI engine (llama.cpp) goes in this folder.

Run "npm run engine:fetch" in the project folder to download the right build
for this computer. It is placed in a subfolder here ("vulkan", "cpu" or
"metal") and is then included in the installer automatically.

The engine files themselves are not kept in the source repository.
