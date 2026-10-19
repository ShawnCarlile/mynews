import 'package:flutter/material.dart';

import '../format.dart';
import '../models.dart';
import '../widgets.dart';
import 'perspective_screen.dart';

/// Shows the stored AI analysis. Opening this screen never triggers AI generation;
/// it displays what the server produced during its hourly run.
class AiAnalysisScreen extends StatelessWidget {
  const AiAnalysisScreen({super.key, required this.story});

  final StoryDetail story;

  @override
  Widget build(BuildContext context) {
    final s = story.summary;
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13.5);

    return Scaffold(
      appBar: AppBar(title: const Text('AI analysis'), leading: const BackButton()),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            Text(story.headline, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const AiTag(),
                if (s.hasContent) Text('Generated ${friendlyTime(s.generatedAt)}${s.model != null ? ' · ${s.model}' : ''}', style: muted),
              ],
            ),
            const SizedBox(height: 12),
            if (s.message != null) _StatusNotice(status: s.status, message: s.message!),
            if (!s.hasContent) ...[
              InfoCard(
                child: Text(
                  s.status == 'failed'
                      ? 'No AI summary is available for this story right now. The original coverage is still available from the story screen.'
                      : 'The AI summary for this story is not ready yet. The original coverage is available from the story screen.',
                ),
              ),
            ] else ...[
              InfoCard(title: 'Overview', child: Text(s.overview!)),
              if ((s.agreement ?? '').isNotEmpty) InfoCard(title: 'What sources agree on', child: Text(s.agreement!)),
              if ((s.disagreement ?? '').isNotEmpty) InfoCard(title: 'Where sources differ', child: Text(s.disagreement!)),
              if ((s.uncertainty ?? '').isNotEmpty) InfoCard(title: 'Uncertain or unconfirmed', child: Text(s.uncertainty!)),
              Text('Agreement among sources is not proof that a claim is true.', style: muted),

              const SectionHeader('Explore perspectives'),
              if (s.perspectivesStatus != 'supported' || s.perspectives.length < 2)
                InfoCard(child: Text(s.perspectivesMessage ?? 'Insufficient evidence for distinct perspectives'))
              else
                for (final p in s.perspectives)
                  ActionTile(
                    label: p.label,
                    subtitle: 'Supported by ${plural(p.articleIds.length, 'article')}',
                    action: 'View',
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PerspectiveScreen(story: story, perspective: p))),
                  ),

              const SectionHeader('Supporting articles'),
              for (final (i, id) in s.overviewArticleIds.indexed)
                if (story.articleById(id) case final a?)
                  ActionTile(label: '[${i + 1}] ${a.publisherName}', subtitle: a.title, action: 'Open', onTap: () => openExternal(context, a.url)),
              const SizedBox(height: 8),
              Text(s.inputScopeNote ?? 'Input scope: available feed excerpts. Read original coverage for full context.', style: muted),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusNotice extends StatelessWidget {
  const _StatusNotice({required this.status, required this.message});

  final String status;
  final String message;

  @override
  Widget build(BuildContext context) {
    final warn = status == 'failed' || status == 'outdated';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: warn ? const Color(0xFFFFF4E5) : const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: warn ? const Color(0xFFF0C27B) : const Color(0xFFBFDBFE)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(warn ? Icons.warning_amber_rounded : Icons.info_outline, color: warn ? const Color(0xFF9A5B00) : const Color(0xFF1D4ED8)),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: const TextStyle(fontSize: 14.5))),
        ],
      ),
    );
  }
}
