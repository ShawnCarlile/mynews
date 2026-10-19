import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'format.dart';

/// Opens a publisher or background page in the browser. My News stays on the same screen underneath,
/// so pressing Back returns to the selected story.
Future<void> openExternal(BuildContext context, String url) async {
  final messenger = ScaffoldMessenger.of(context);
  final uri = Uri.tryParse(url);
  var ok = false;
  if (uri != null) {
    try {
      ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      ok = false;
    }
  }
  if (!ok) {
    messenger.showSnackBar(const SnackBar(
      content: Text('Could not open the page. Publisher pages need an internet connection.'),
    ));
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// A full-width, easy-to-tap row button: label (+ optional subtitle) and an action word.
class ActionTile extends StatelessWidget {
  const ActionTile({super.key, required this.label, this.subtitle, required this.action, required this.onTap, this.icon});

  final String label;
  final String? subtitle;
  final String action;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  if (icon != null) ...[Icon(icon, size: 22, color: scheme.primary), const SizedBox(width: 12)],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                        if (subtitle != null && subtitle!.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(subtitle!, style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant)),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(action, style: TextStyle(color: scheme.primary, fontWeight: FontWeight.w700, fontSize: 15)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class InfoCard extends StatelessWidget {
  const InfoCard({super.key, this.title, required this.child, this.tone});

  final String? title;
  final Widget child;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: tone ?? scheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(title!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
          ],
          DefaultTextStyle.merge(style: const TextStyle(fontSize: 15.5, height: 1.4), child: child),
        ],
      ),
    );
  }
}

/// Small pill used to mark AI text, demo fixtures, and summary status.
class Tag extends StatelessWidget {
  const Tag(this.text, {super.key, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(text, style: TextStyle(color: c, fontSize: 12.5, fontWeight: FontWeight.w700)),
    );
  }
}

class AiTag extends StatelessWidget {
  const AiTag({super.key});

  @override
  Widget build(BuildContext context) => const Tag('AI-generated', color: Color(0xFF6A3FB5));
}

class FixtureTag extends StatelessWidget {
  const FixtureTag({super.key});

  @override
  Widget build(BuildContext context) => const Tag('DEMO FIXTURE', color: Color(0xFFB45309));
}

/// Shown when content came from the on-device cache instead of the server.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.syncedAt, this.reason, required this.onRetry});

  final DateTime syncedAt;
  final String? reason;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      decoration: BoxDecoration(color: const Color(0xFFFFF4E5), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFF0C27B))),
      child: Row(
        children: [
          const Icon(Icons.cloud_off, color: Color(0xFF9A5B00)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Offline mode: showing saved copy from ${friendlyTime(syncedAt)}.${reason != null ? ' $reason' : ''}',
              style: const TextStyle(color: Color(0xFF6B3F00), fontSize: 14),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class MessageView extends StatelessWidget {
  const MessageView({super.key, required this.icon, required this.title, required this.message, this.actionLabel, this.onAction});

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15.5)),
            if (actionLabel != null) ...[
              const SizedBox(height: 20),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [const CircularProgressIndicator(), const SizedBox(height: 16), Text(label, textAlign: TextAlign.center)],
      ),
    );
  }
}
