import 'package:intl/intl.dart';

/// "Today, 9:40 AM", "Yesterday, 6:05 PM", or "Oct 14, 3:12 PM".
String friendlyTime(DateTime? t, {DateTime? now}) {
  if (t == null) return 'Unknown time';
  final n = now ?? DateTime.now();
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(t.year, t.month, t.day);
  final time = DateFormat.jm().format(t);
  if (day == today) return 'Today, $time';
  if (day == today.subtract(const Duration(days: 1))) return 'Yesterday, $time';
  return '${DateFormat.MMMd().format(t)}, $time';
}

String plural(int n, String word) => '$n $word${n == 1 ? '' : 's'}';
