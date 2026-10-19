import 'package:flutter/material.dart';

import '../format.dart';
import '../models.dart';
import '../widgets.dart';

/// Chooser for a publisher that has several articles in one story.
class PublisherArticlesScreen extends StatelessWidget {
  const PublisherArticlesScreen({super.key, required this.publisher});

  final PublisherGroup publisher;

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13.5);
    return Scaffold(
      appBar: AppBar(title: Text(publisher.name), leading: const BackButton()),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Text('${plural(publisher.articles.length, 'article')} from ${publisher.name} on this story', style: muted),
            const SizedBox(height: 12),
            for (final a in publisher.articles)
              InfoCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 4),
                    Text(friendlyTime(a.publishedAt), style: muted),
                    if (a.excerpt.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text('“${a.excerpt}”'),
                      const SizedBox(height: 4),
                      Text('Feed excerpt (original wording), not the full article', style: muted),
                    ],
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.tonal(onPressed: () => openExternal(context, a.url), child: const Text('Open article')),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
