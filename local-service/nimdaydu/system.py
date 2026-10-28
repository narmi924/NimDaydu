"""Platform differences: setup script names and real-time scheduling."""
import ctypes
import logging
import sys

log = logging.getLogger("nimdaydu")

IS_WINDOWS = sys.platform == 'win32'
IS_MAC = sys.platform == 'darwin'
PLATFORM = 'windows' if IS_WINDOWS else 'mac' if IS_MAC else sys.platform
SETUP_SCRIPT = 'setup.ps1' if IS_WINDOWS else 'setup.sh'
START_SCRIPT = 'Start-NimDaydu.cmd' if IS_WINDOWS else 'Start-NimDaydu.command'


def prefer_performance():
    """Keep live recognition off throttled cores.

    The service runs without a window, so Windows 11 treats it as background
    work (EcoQoS). Hybrid Intel CPUs then schedule it on efficiency cores, where
    a continuous meeting can outrun the recognizer. Opting out of execution
    speed throttling is the documented switch for real-time work.
    """
    if not IS_WINDOWS:
        return False

    class PowerThrottlingState(ctypes.Structure):
        _fields_ = [('Version', ctypes.c_ulong), ('ControlMask', ctypes.c_ulong), ('StateMask', ctypes.c_ulong)]

    process_power_throttling, execution_speed = 4, 0x1
    # Control the setting, with the state bit clear: never throttle.
    state = PowerThrottlingState(1, execution_speed, 0)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    if not kernel32.SetProcessInformation(kernel32.GetCurrentProcess(), process_power_throttling,
                                          ctypes.byref(state), ctypes.sizeof(state)):
        log.warning('Could not opt out of Windows power throttling (error %s)', ctypes.get_last_error())
        return False
    return True
