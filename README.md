# Multi-Level Feedback Queue (MLFQ) Scheduler

A C++ implementation of a Multi-Level Feedback Queue scheduling algorithm for process management.

## Overview

This project simulates a CPU scheduler using the Multi-Level Feedback Queue (MLFQ) algorithm, which dynamically adjusts process priorities based on their behavior and resource usage.

## Features

- **Multiple Priority Levels**: Processes are organized into different priority queues
- **Dynamic Priority Adjustment**: Processes can be promoted or demoted between priority levels
- **Preemptive Scheduling**: Supports quantum-based preemption
- **I/O Blocking Support**: Optional I/O blocking for processes that need it
- **Process States**: NEW, READY, RUNNING, BLOCKED, TERMINATED

## Project Structure

```
MultiLevelFeedbackQueue/
??? main.cpp              # Main entry point and simulation loop
??? CPU.h                 # CPU class definition and implementation
??? Process.h             # Process class with state management
??? Scheduler.h           # MLFQ Scheduler implementation
??? Constants.h           # Shared constants (LEVELS)
??? README.md            # This file
```

## Classes

### Process
- Manages process state, priority level, and remaining ticks
- Supports optional I/O blocking (set `io_block_every` to -1 for no blocking)
- Tracks CPU ticks used for scheduling decisions

### CPU
- Simulates CPU execution with quantum-based time slicing
- Handles process state transitions (RUNNING ? TERMINATED/BLOCKED/READY)
- Returns tick results for scheduler feedback

### Scheduler
- Manages multiple priority queues (default: 3 levels)
- Schedules processes based on priority (higher priority first)
- Handles process enqueueing and dequeueing

## Usage

```cpp
std::map<int, Process> process_table;

// Create a process with PID=1, 5 ticks, no I/O blocking
Process process1(1, 5);
process_table.insert({1, process1});

// Create a process with PID=2, 4 ticks, I/O blocks every 2 ticks
Process process2(2, 4, 2);
process_table.insert({2, process2});

Scheduler scheduler(process_table);
CPU cpu(process_table);

// Enqueue processes
scheduler.enqueue(1);
scheduler.enqueue(2);

// Simulation loop
while (!scheduler.empty() || cpu.state() == CPU_STATE::RUNNING) {
    if (cpu.state() == CPU_STATE::IDLE && !scheduler.empty()) {
        int pid = scheduler.schedule();
        int quantum = scheduler.quantum_for_level(process_table[pid].level());
        cpu.assign(pid, quantum);
    }
    
    auto result = cpu.tick();
    scheduler.handle_event(cpu.current_pid(), result);
}
```

## Building

This project uses Visual Studio 2022 (or compatible).

```bash
# Build using Visual Studio
msbuild MultiLevelFeedbackQueue.vcxproj /p:Configuration=Release

# Or open in Visual Studio and build (Ctrl+Shift+B)
```

## Configuration

You can modify the number of priority levels in `Constants.h`:

```cpp
constexpr int LEVELS = 3;  // Change this value as needed
```

## Process Creation

- **Without I/O blocking**: `Process(pid, remaining_ticks)`
- **With I/O blocking**: `Process(pid, remaining_ticks, io_block_every)`

Setting `io_block_every` to `-1` or `0` disables I/O blocking for that process.

## License

This project is open source and available for educational purposes.

## Author

duc-minh-droid
